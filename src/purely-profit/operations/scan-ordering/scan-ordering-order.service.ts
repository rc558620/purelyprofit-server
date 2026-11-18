import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import type { ListScanOrderingOrdersDto } from './dto/scan-ordering-order-query.dto';
import { ScanOrderingPricingService } from './scan-ordering-pricing.service';
import type {
  ScanOrderingOrderDetailPayload,
  ScanOrderingOrderListItem,
} from './scan-ordering.types';
import { ScanOrderingOrderStateMachineService } from './scan-ordering-order-machine.service';
import {
  buildListWhere,
  fetchPriorityPage,
  resolveListStatuses,
  resolveListTimeRange,
} from './scan-ordering-order-query.helper';
import { ScanOrderingPickupNumberService } from '../../../purely-club/scan-ordering/scan-ordering-pickup-number.service';
import {
  toOrderDetailPayload,
  toOrderListItem,
  type ScanOrderListItemSource,
} from './scan-ordering-order.mapper';

/** ROW_NUMBER 为 int8，驱动可能回传 bigint/string。 */
type DiningRoundSequenceRow = {
  id: number;
  sequence: number | string | bigint;
};

/**
 * 商家扫码点餐订单服务（查询编排 + 状态流转代理）。
 *
 * - 状态流转：代理到 ScanOrderingOrderStateMachineService
 * - 查询编排：负责门店校验、时间范围、筛选条件、昵称/加餐序号查询
 * - 响应组装：下沉到 scan-ordering-order.mapper（纯函数，金额统一后端计算）
 */
@Injectable()
export class ScanOrderingOrderService {
  private readonly logger = new Logger(ScanOrderingOrderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly pricingService: ScanOrderingPricingService,
    private readonly stateMachineService: ScanOrderingOrderStateMachineService,
    private readonly pickupNumberService: ScanOrderingPickupNumberService,
  ) {}

  // ── 状态流转代理 ─────────────────────────────────────────

  async acceptOrder(
    user: AuthenticatedUser,
    orderId: number,
    version: number,
  ): Promise<void> {
    return this.stateMachineService.acceptOrder(user, orderId, version);
  }

  async serveOrder(
    user: AuthenticatedUser,
    orderId: number,
    version: number,
  ): Promise<void> {
    return this.stateMachineService.serveOrder(user, orderId, version);
  }

  async rejectOrder(
    user: AuthenticatedUser,
    orderId: number,
    version: number,
    reason: string,
  ): Promise<void> {
    return this.stateMachineService.rejectOrder(user, orderId, version, reason);
  }

  async cancelOrder(
    user: AuthenticatedUser,
    orderId: number,
    version: number,
    reason: string,
  ): Promise<void> {
    return this.stateMachineService.cancelOrder(user, orderId, version, reason);
  }

  async completeOrder(
    user: AuthenticatedUser,
    orderId: number,
    version: number,
  ): Promise<void> {
    return this.stateMachineService.completeOrder(user, orderId, version);
  }

  async completeRefund(
    user: AuthenticatedUser,
    orderId: number,
    version: number,
    provider?: { refundNo?: string; refundId?: string },
  ): Promise<void> {
    return this.stateMachineService.completeRefund(
      user,
      orderId,
      version,
      provider,
    );
  }

  // ── 订单查询 ─────────────────────────────────────────────

  async listOrders(
    user: AuthenticatedUser,
    query: ListScanOrderingOrdersDto,
  ): Promise<{
    items: ScanOrderingOrderListItem[];
    nextCursor: number | null;
  }> {
    const storeId = await this.resolveOrderStoreId(user);
    const { startOfDay, endOfDay } = resolveListTimeRange(query);
    const where = buildListWhere(storeId, query, startOfDay, endOfDay);
    const limit = query.limit ?? 100;
    const { pageOrders, hasMore } = await fetchPriorityPage(
      this.prisma,
      where,
      resolveListStatuses(query),
      limit,
    );
    // “首单/加餐”判定以 diningRoundId 维度计算：同一用餐轮次（diningRoundId 相同）
    // 内的累计下单序号，跨桌或清桌（diningRoundId 重新生成）会重新从 1 开始。
    // 昵称与序号都只依赖订单页、互不依赖，并行发起省一次往返。
    const [guestNameMap, sequences] = await Promise.all([
      this.fetchGuestNameMap(pageOrders),
      this.fetchDiningRoundSequences(pageOrders, storeId),
    ]);
    return {
      items: pageOrders.map((order) =>
        toOrderListItem({
          order,
          guestName: this.resolveGuestName(order, guestNameMap),
          sessionOrderSequence: sequences.get(order.id) ?? 1,
          calculateSummary: this.pricingService.calculateSummary,
          formatPickupNumber: this.pickupNumberService.formatPickupNumber,
        }),
      ),
      nextCursor: hasMore ? (pageOrders.at(-1)?.id ?? null) : null,
    };
  }

  async getOrderDetail(
    user: AuthenticatedUser,
    orderId: number,
  ): Promise<ScanOrderingOrderDetailPayload> {
    const storeId = await this.resolveOrderStoreId(user);
    const order = await this.prisma.scanOrders.findFirst({
      where: { id: orderId, storeId },
      include: {
        table: { select: { name: true, tableCode: true } },
        items: { include: { specs: true }, orderBy: { id: 'asc' } },
        histories: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!order) throw new NotFoundException('扫码点餐订单不存在');
    return toOrderDetailPayload({
      order,
      calculateSummary: this.pricingService.calculateSummary,
      formatPickupNumber: this.pickupNumberService.formatPickupNumber,
    });
  }

  // ── 查询私有方法 ─────────────────────────────────────────

  /** 统一解析当前商家门店并校验查看权限。 */
  private resolveOrderStoreId(user: AuthenticatedUser): Promise<number> {
    return this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      'scan-ordering:view',
      '无权查看扫码点餐订单',
    );
  }

  /** 批量查询顾客昵称；缺失或查询失败时回退为“顾客”。 */
  private async fetchGuestNameMap(
    orders: ScanOrderListItemSource[],
  ): Promise<Map<number, string>> {
    const userMap = new Map<number, string>();
    const uniqueIds = Array.from(
      new Set(
        orders
          .map((order) => order.clubUserId)
          .filter((id): id is number => !!id),
      ),
    );
    if (uniqueIds.length === 0) return userMap;
    try {
      const users = await this.prisma.user.findMany({
        where: { id: { in: uniqueIds } },
        select: { id: true, name: true },
      });
      users.forEach((user) => {
        userMap.set(user.id, user.name || '顾客');
      });
    } catch (error) {
      // 昵称不影响订单展示：失败时统一回退「顾客」，不打断列表接口
      this.logger.error(
        `批量查询顾客昵称失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return userMap;
  }

  /**
   * 计算“首单/加餐”序号：同一 diningRound 内同一用户的累计下单序号。
   * 由数据库窗口函数排名、只回传当前页序号，避免把轮次历史全量拉回进程。
   */
  private async fetchDiningRoundSequences(
    orders: ScanOrderListItemSource[],
    storeId: number,
  ): Promise<Map<number, number>> {
    const sequences = new Map<number, number>();
    const keys = orders.flatMap((order) =>
      order.diningRoundId && typeof order.clubUserId === 'number'
        ? [{ diningRoundId: order.diningRoundId, clubUserId: order.clubUserId }]
        : [],
    );
    if (keys.length === 0) return sequences;

    const roundIds = Array.from(new Set(keys.map((key) => key.diningRoundId)));
    const clubUserIds = Array.from(new Set(keys.map((key) => key.clubUserId)));
    const orderIds = orders.map((order) => order.id);

    // 笛卡尔积多扫的行落在别的分区不影响编号；门店前缀与全分区排名均不可省略。
    const rows = await this.prisma.$queryRaw<DiningRoundSequenceRow[]>`
      WITH ranked AS (
        SELECT
          "id",
          ROW_NUMBER() OVER (
            PARTITION BY "dining_round_id", "club_user_id"
            ORDER BY "created_at" ASC, "id" ASC
          ) AS "sequence"
        FROM "scan_orders"
        WHERE "store_id" = ${storeId}
          AND "deleted_at" IS NULL
          AND "dining_round_id" IN (${Prisma.join(
            roundIds.map((id) => Prisma.sql`${id}::uuid`),
          )})
          AND "club_user_id" IN (${Prisma.join(clubUserIds)})
      )
      SELECT "id", "sequence" FROM ranked
      WHERE "id" IN (${Prisma.join(orderIds)})
    `;
    for (const row of rows) {
      sequences.set(Number(row.id), Number(row.sequence));
    }
    return sequences;
  }

  /** 解析顾客昵称展示值。 */
  private resolveGuestName(
    order: {
      clubUserId: number | null;
      manualEntry: boolean;
      manualEntryMetadata: unknown;
    },
    guestNameMap: Map<number, string>,
  ): string {
    if (order.manualEntry) {
      const meta = order.manualEntryMetadata as Record<string, unknown> | null;
      const sourceChannel = meta?.sourceChannel as string | undefined;
      const channelLabels: Record<string, string> = {
        meituan: '美团外卖',
        eleme: '饿了么',
        meituanVoucher: '美团团购',
        douyin: '抖音团购',
        dianping: '大众点评',
        other: '其他平台',
      };
      return sourceChannel
        ? (channelLabels[sourceChannel] ?? sourceChannel)
        : '手工录入';
    }
    if (order.clubUserId && guestNameMap.has(order.clubUserId)) {
      return guestNameMap.get(order.clubUserId)!;
    }
    return '顾客';
  }
}
