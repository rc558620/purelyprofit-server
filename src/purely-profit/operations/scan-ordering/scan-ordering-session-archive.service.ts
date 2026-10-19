import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service';
import { ScanOrderingRealtimeService } from '../../../purely-club/scan-ordering/scan-ordering-realtime.service';
import type { RealtimePickupNumberStatus } from '../../../purely-club/scan-ordering/scan-ordering-realtime.types';
import { ScanOrderingPickupNumberService } from '../../../purely-club/scan-ordering/scan-ordering-pickup-number.service';
import { getShanghaiHour } from '../../../shared/shanghai-time.utils';

/** 空闲阈值默认值（日间 / 夜间共用）：最后活动超过该时长即视为可归档。 */
const DEFAULT_ARCHIVE_IDLE_MS = 2 * 60 * 60 * 1000;
/** 夜间窗口默认起止小时（上海时区）：22:00–06:00，可用配置覆盖。 */
const DEFAULT_NIGHT_START_HOUR = 22;
const DEFAULT_NIGHT_END_HOUR = 6;
const AUTO_ARCHIVE_BATCH_SIZE = 100;

/** 本轮扫描的空闲策略（日间 / 夜间分档）。 */
interface ArchiveIdlePolicy {
  /** 日间阈值：最后活动超过该时长即归档，不等会话过期。 */
  dayIdleMs: number;
  /** 夜间阈值：会话过期后，最后活动再超过该时长才归档。 */
  nightIdleMs: number;
  /** 夜间窗口起始小时（含）。 */
  nightStartHour: number;
  /** 夜间窗口结束小时（不含）。 */
  nightEndHour: number;
}
/**
 * 未完结的手工录入单状态：这些单不挂扫码会话（sessionId 为 null），
 * 但同样占用桌台、且必须由商家手动处理，存在时不得自动归档该桌会话
 * （与手动清桌 ScanOrderingTableClearService.assertNoBlockingOrder 的手工单口径一致）。
 */
const BLOCKING_MANUAL_ENTRY_STATUSES = [
  'pending_acceptance',
  'preparing',
] as const;
/**
 * 仍在履约、不允许自动归档的订单状态。
 *
 * ⚠️ 必须与「已闭环」状态严格区分：早期实现要求「会话内订单全部是 served」才归档，
 * 于是只要该会话里有一笔 rejected（商家拒单 / 系统超时退款）或 completed 订单，
 * 条件就永远不成立 —— 桌台长期停在「用餐中」、served 单永不完结，商家端桌台与
 * C 端订单追踪页都无法收敛（真实故障：A01 滞留一整天，凌晨订单既不在当前订单
 * 也不在历史记录）。已闭环订单（served / completed / rejected / cancelled）
 * 一律不阻塞归档。
 */
const FULFILLING_ORDER_STATUSES = [
  'pending_payment',
  'pending_acceptance',
  'preparing',
  'refunding',
] as const;

/** 取两个可空时间中较晚的一个；都为 null 时返回 null。 */
const laterOf = (
  left: Date | null | undefined,
  right: Date | null | undefined,
): Date | null => {
  if (!left) return right ?? null;
  if (!right) return left;
  return left > right ? left : right;
};

/** 归档闭环订单的实时推送快照字段（served → completed 后用于 order.status_changed）。 */
interface ArchivedOrderSnapshot {
  id: number;
  version: number | null;
  paymentStatus: string | null;
  pickupNumber: number | null;
  pickupNumberStatus: RealtimePickupNumberStatus;
  pickupCalledAt: Date | null;
  pickupCompletedAt: Date | null;
}

@Injectable()
export class ScanOrderingSessionArchiveService {
  private readonly logger = new Logger(ScanOrderingSessionArchiveService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly realtimeService: ScanOrderingRealtimeService,
    private readonly pickupNumberService: ScanOrderingPickupNumberService,
  ) {}

  /**
   * 读取本轮扫描的空闲策略。
   *
   * 分档原因：夜宵 / 火锅这类长时段用餐可能持续到凌晨，若只按「最后出餐 + 阈值」清桌，
   * 会在客人还在座时把桌台置空（商家看到空桌可能收台）。因此夜间窗口额外要求会话
   * expiresAt 已过期；日间则只看最后活动，避免 4 小时 TTL 成为下限拖慢午 / 晚市翻台。
   */
  private resolveIdlePolicy(): ArchiveIdlePolicy {
    const numberConfig = (key: string, fallback: number): number => {
      const value = this.configService.get<number>(key);
      return typeof value === 'number' && Number.isFinite(value) && value > 0
        ? value
        : fallback;
    };
    return {
      dayIdleMs: numberConfig(
        'scanOrdering.sessionArchiveIdleMs',
        DEFAULT_ARCHIVE_IDLE_MS,
      ),
      nightIdleMs: numberConfig(
        'scanOrdering.sessionArchiveNightIdleMs',
        DEFAULT_ARCHIVE_IDLE_MS,
      ),
      // 夜间窗口允许 0–23 任意起止（支持 22→6 这类跨零点区间）
      nightStartHour: Math.min(
        23,
        Math.max(
          0,
          this.configService.get<number>(
            'scanOrdering.sessionArchiveNightStartHour',
          ) ?? DEFAULT_NIGHT_START_HOUR,
        ),
      ),
      nightEndHour: Math.min(
        23,
        Math.max(
          0,
          this.configService.get<number>(
            'scanOrdering.sessionArchiveNightEndHour',
          ) ?? DEFAULT_NIGHT_END_HOUR,
        ),
      ),
    };
  }

  async archiveEligibleSessions(now = new Date()): Promise<number> {
    const policy = this.resolveIdlePolicy();
    const sessions = await this.prisma.scanOrderingSession.findMany({
      where: {
        // left 会话同样要归档：顾客重新扫码会把旧会话置 left 并软删除，其中的
        // served 单若无人归档就永远是「已出餐未完结」，既占着 C 端当前订单，
        // 又因非终态进不了历史记录（只能靠商家手动清桌清理）。
        OR: [{ status: 'active', deletedAt: null }, { status: 'left' }],
        // 候选筛选必须在 SQL 层排除「仍有未履约订单」的会话：否则这批永远不能归档的
        // 会话会长期占满 take 名额，把排在其后的可归档会话饿死（批量扫描不收敛）。
        orders: {
          // 0 订单的空会话没有归档价值（事务内 orders.length===0 会跳过），
          // 必须在 SQL 层排除，否则会随时间累积并逐渐占满 take 批次名额。
          some: { deletedAt: null },
          none: {
            deletedAt: null,
            status: { in: [...FULFILLING_ORDER_STATUSES] },
          },
        },
      },
      select: { id: true, storeId: true, tableId: true },
      take: AUTO_ARCHIVE_BATCH_SIZE,
      orderBy: { id: 'asc' },
    });
    let archived = 0;
    for (const session of sessions) {
      if (
        await this.archiveSessionIfEligible(
          session.id,
          session.storeId,
          session.tableId,
          policy,
          now,
        )
      )
        archived += 1;
    }
    if (archived > 0) this.logger.log(`已自动归档 ${archived} 个扫码点餐会话`);
    return archived;
  }

  private async archiveSessionIfEligible(
    sessionId: number,
    storeId: number,
    tableId: number | null,
    policy: ArchiveIdlePolicy,
    now: Date,
  ): Promise<boolean> {
    if (!tableId) return false;
    /** 事务内收集被闭环（served → completed）的订单，事务提交后再发实时事件（事务内不做 IO） */
    let completedOrders: ArchivedOrderSnapshot[] = [];
    const archived = await this.prisma.$transaction(async (tx) => {
      const session = await tx.scanOrderingSession.findFirst({
        where: {
          id: sessionId,
          status: { in: ['active', 'left'] },
        },
        select: { id: true, lastActiveAt: true, expiresAt: true },
      });
      if (!session) return false;
      // 手工录入单不挂会话，但同属该桌这一轮：还有未出餐的录入单时不得归档，
      // 否则会把商家尚未处理的录入单连同桌台一起「自动清掉」。
      const blockingManualEntries = await tx.scanOrders.count({
        where: {
          storeId,
          tableId,
          manualEntry: true,
          deletedAt: null,
          status: { in: [...BLOCKING_MANUAL_ENTRY_STATUSES] },
        },
      });
      if (blockingManualEntries > 0) return false;
      const orders = await tx.scanOrders.findMany({
        where: { sessionId, deletedAt: null },
        select: {
          id: true,
          status: true,
          servedAt: true,
          completedAt: true,
          // 归档后要按 order.status_changed 推送，字段与手动「完成订单」事件保持一致
          version: true,
          paymentStatus: true,
          fulfillmentStatus: true,
          pickupNumber: true,
          pickupNumberStatus: true,
          pickupCalledAt: true,
          pickupCompletedAt: true,
        },
      });
      if (orders.length === 0) return false;
      // 仍有未履约订单（待接单 / 制作中 / 退款中）：不得归档，
      // 否则会把商家还没处理的订单直接埋进历史。
      if (
        orders.some((order) =>
          (FULFILLING_ORDER_STATUSES as readonly string[]).includes(
            order.status,
          ),
        )
      )
        return false;
      // 最后活动时间 = max(最后一笔订单履约时间, 会话最后活跃时间)：
      // 拒单 / 已退款订单没有 servedAt，用会话最后活跃时间兜底；顾客持续加单、
      // 出餐较晚时自然顺延，只会更保守。
      const lastActivityAt = orders.reduce<Date | null>((latest, order) => {
        const at = order.servedAt ?? order.completedAt ?? null;
        if (!at) return latest;
        return !latest || at > latest ? at : latest;
      }, session.lastActiveAt ?? null);
      if (!lastActivityAt) return false;

      // 按「最后活动」落在日间还是夜间窗口选口径：
      // - 夜间（默认 22:00–06:00）：额外等会话 expiresAt 过期。夜宵 / 火锅可能吃到凌晨，
      //   只按最后出餐计时会在客人还在座时把桌台置空（商家看到空桌可能收台）。
      // - 日间：只看最后活动，不等 TTL。否则 4 小时 TTL 成为下限，午市 12 点的单
      //   要拖到 18 点才释放，翻台与统计口径都被拖慢。
      const activityHour = getShanghaiHour(lastActivityAt.getTime());
      const isNightWindow =
        activityHour >= policy.nightStartHour ||
        activityHour < policy.nightEndHour;
      const idleSince = isNightWindow
        ? (laterOf(session.expiresAt, lastActivityAt) ?? lastActivityAt)
        : lastActivityAt;
      const idleMs = isNightWindow ? policy.nightIdleMs : policy.dayIdleMs;
      if (idleSince.getTime() > now.getTime() - idleMs) return false;
      const updated = await tx.scanOrderingSession.updateMany({
        where: { id: sessionId, status: { in: ['active', 'left'] } },
        data: {
          status: 'checked_out',
          endedAt: now,
          archiveReason: 'auto_timeout',
        },
      });
      if (updated.count === 0) return false;
      await tx.scanOrderingCartItem.updateMany({
        where: { sessionId, status: 'active' },
        data: { status: 'removed' },
      });
      // 归档会话的同时闭环已出餐订单（served → completed）：
      // 出餐后商家长时间未确认完成时，订单随会话一并自动完成，
      // 避免产生「会话已结束但订单仍为 served」的孤儿单导致清桌/列表长期滞留。
      await tx.scanOrders.updateMany({
        where: { sessionId, deletedAt: null, status: 'served' },
        data: { status: 'completed', completedAt: now },
      });
      // 该桌已出餐的手工录入单一并闭环（对齐手动清桌的 archiveRound）：
      // 录入单不挂扫码会话，若只闭环会话内订单，归档后会留下「已出餐未完结」的录入单。
      await tx.scanOrders.updateMany({
        where: {
          storeId,
          tableId,
          manualEntry: true,
          deletedAt: null,
          status: 'served',
        },
        data: { status: 'completed', completedAt: now },
      });
      await tx.scanOrderStatusHistory.createMany({
        data: orders
          .filter((order) => order.status === 'served')
          .map((order) => ({
            orderId: order.id,
            storeId,
            fromStatus: 'served',
            toStatus: 'completed',
            operatorType: 'system',
            reason: '会话超时归档，订单自动完成',
          })),
      });
      const otherActiveSessions = await tx.scanOrderingSession.count({
        where: { storeId, tableId, status: 'active', deletedAt: null },
      });
      if (otherActiveSessions === 0)
        await tx.scanOrderingTable.updateMany({
          where: { id: tableId, storeId, status: { not: 'disabled' } },
          data: { status: 'empty', version: { increment: 1 } },
        });
      completedOrders = orders.filter((order) => order.status === 'served');
      return true;
    });
    if (archived) {
      this.publishOrdersCompleted(storeId, sessionId, completedOrders, now);
    }
    return archived;
  }

  /**
   * 自动清桌闭环的订单逐笔推送 `order.status_changed`（status=completed）。
   *
   * 复用既有事件契约而不是新增事件类型：商家端收到后刷新订单/桌台聚合
   * （桌台不再停留在「用餐中」，无需手动刷新），C 端 orderTracking 收到后
   * 订单转入点餐记录，两侧同时收敛。
   */
  private publishOrdersCompleted(
    storeId: number,
    sessionId: number,
    orders: ArchivedOrderSnapshot[],
    now: Date,
  ): void {
    for (const order of orders) {
      try {
        this.realtimeService.publishOrderStatusChanged({
          storeId,
          orderId: order.id,
          sessionId,
          version: order.version ?? undefined,
          status: 'completed',
          paymentStatus: order.paymentStatus ?? 'paid',
          fulfillmentStatus: 'closed',
          pickupNumber: order.pickupNumber ?? null,
          pickupNumberLabel: this.pickupNumberService.formatPickupNumber(
            order.pickupNumber,
          ),
          pickupNumberStatus: order.pickupNumberStatus ?? null,
          pickupCalledAt: order.pickupCalledAt?.toISOString() ?? null,
          pickupCompletedAt:
            order.pickupCompletedAt?.toISOString() ?? now.toISOString(),
        });
      } catch (error: unknown) {
        // 推送失败不影响归档结果（列表会在下次刷新时收敛）
        this.logger.error(
          `自动归档订单实时事件推送失败 orderId=${order.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
}
