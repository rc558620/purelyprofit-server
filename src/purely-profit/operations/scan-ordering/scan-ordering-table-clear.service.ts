import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { MANUAL_ENTRY_ROUND_STATUSES } from './scan-ordering-table.types';

/** 清桌时仍在履约的扫码订单状态：这些订单所在的 active 会话才算有效轮次锚点。 */
const FULFILLING_ORDER_STATUSES = [
  'pending_payment',
  'pending_acceptance',
  'preparing',
  'served',
] as const;

/** 扫码点餐桌台清桌服务：校验当前用餐轮次可清桌后归档会话与订单。 */
@Injectable()
export class ScanOrderingTableClearService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
  ) {}

  async clearTable(user: AuthenticatedUser, tableId: number): Promise<void> {
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      'scan-ordering:table-manage',
      '无权操作扫码点餐桌台',
    );
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await this.assertTableExists(tx, storeId, tableId);

      const activeSessions = await this.findActiveSessions(
        tx,
        storeId,
        tableId,
        now,
      );
      const manualEntryOrders = await this.findManualEntryOrders(
        tx,
        storeId,
        tableId,
      );
      await this.assertRoundExists(
        tx,
        storeId,
        tableId,
        activeSessions.length,
        manualEntryOrders.length,
      );

      const sessions = await this.resolveRoundSessions(
        tx,
        storeId,
        tableId,
        activeSessions,
      );
      const orders = await this.findSessionOrders(tx, sessions);
      this.assertNoBlockingOrder(orders, manualEntryOrders);

      await this.archiveRound(tx, storeId, tableId, sessions, now);
    });
  }

  private async assertTableExists(
    tx: Prisma.TransactionClient,
    storeId: number,
    tableId: number,
  ): Promise<void> {
    const table = await tx.scanOrderingTable.findFirst({
      where: { id: tableId, storeId, deletedAt: null },
      select: { id: true },
    });
    if (!table) throw new NotFoundException('扫码点餐桌台不存在');
  }

  /** 有效 active 会话是当前用餐轮次的锚点：未过期或仍持有待履约订单。 */
  private findActiveSessions(
    tx: Prisma.TransactionClient,
    storeId: number,
    tableId: number,
    now: Date,
  ) {
    return tx.scanOrderingSession.findMany({
      where: {
        storeId,
        tableId,
        status: 'active',
        deletedAt: null,
        OR: [
          { expiresAt: { gt: now } },
          {
            orders: {
              some: {
                deletedAt: null,
                status: { in: [...FULFILLING_ORDER_STATUSES] },
              },
            },
          },
        ],
      },
      select: { id: true, diningRoundId: true },
    });
  }

  /**
   * 手工录入单不挂扫码会话（sessionId=null），单独构成「录入轮次」：
   * 无有效扫码会话但存在手工单（含已完结）时同样允许清桌，避免手工单桌台清不掉。
   */
  private findManualEntryOrders(
    tx: Prisma.TransactionClient,
    storeId: number,
    tableId: number,
  ) {
    return tx.scanOrders.findMany({
      where: {
        storeId,
        tableId,
        manualEntry: true,
        deletedAt: null,
        status: { in: [...MANUAL_ENTRY_ROUND_STATUSES] },
      },
      select: { status: true },
    });
  }

  /**
   * 无任何 active 会话与手工单时，仅当残留离桌（left）会话才允许清桌归档，
   * 防止历史 left 会话长期残留并被新一轮扫码复用 diningRoundId，导致上一轮
   * 退款/历史订单重新出现在新订单详情中。
   */
  private async assertRoundExists(
    tx: Prisma.TransactionClient,
    storeId: number,
    tableId: number,
    activeSessionCount: number,
    manualEntryOrderCount: number,
  ): Promise<void> {
    if (activeSessionCount > 0 || manualEntryOrderCount > 0) return;
    const orphanLeftSessions = await tx.scanOrderingSession.count({
      where: { storeId, tableId, status: 'left' },
    });
    if (orphanLeftSessions === 0) {
      throw new ConflictException('当前桌台不存在有效用餐会话，无法清桌');
    }
  }

  /**
   * 本轮待归档会话：有 active 会话时归档其所在轮次（同桌同轮 active+left），
   * 仅剩遗留 left 会话时归档同桌全部 left 会话。
   */
  private async resolveRoundSessions(
    tx: Prisma.TransactionClient,
    storeId: number,
    tableId: number,
    activeSessions: Array<{ id: number; diningRoundId: string }>,
  ): Promise<Array<{ id: number }>> {
    if (activeSessions.length === 0) {
      return tx.scanOrderingSession.findMany({
        where: { storeId, tableId, status: 'left' },
        select: { id: true },
      });
    }
    const diningRoundIds = activeSessions.map(
      (session) => session.diningRoundId,
    );
    return tx.scanOrderingSession.findMany({
      where: {
        storeId,
        tableId,
        diningRoundId: { in: diningRoundIds },
        status: { in: ['active', 'left'] },
      },
      select: { id: true },
    });
  }

  /**
   * 轮次内仍参与桌台履约的订单：已退款或退款处理中订单不再阻塞，
   * 与桌台抽屉的可见订单保持同一范围。
   */
  private findSessionOrders(
    tx: Prisma.TransactionClient,
    sessions: Array<{ id: number }>,
  ) {
    return tx.scanOrders.findMany({
      where: {
        sessionId: { in: sessions.map((session) => session.id) },
        deletedAt: null,
        status: {
          notIn: ['rejected', 'cancelled', 'completed', 'refunding'],
        },
      },
      select: { status: true },
    });
  }

  /** 阻塞检查统一口径：扫码会话订单与手工单均按「未出餐即阻塞」计算（已完结不阻塞）。 */
  private assertNoBlockingOrder(
    orders: Array<{ status: string }>,
    manualEntryOrders: Array<{ status: string }>,
  ): void {
    const blockingOrderCount =
      orders.filter((order) => order.status !== 'served').length +
      manualEntryOrders.filter(
        (order) => order.status !== 'served' && order.status !== 'completed',
      ).length;
    if (blockingOrderCount > 0) {
      throw new ConflictException(
        `当前桌台仍有 ${blockingOrderCount} 笔订单未出餐，全部出餐后才可清桌`,
      );
    }
  }

  /** 归档本轮会话、完结已出餐订单并把桌台置为空桌。 */
  private async archiveRound(
    tx: Prisma.TransactionClient,
    storeId: number,
    tableId: number,
    sessions: Array<{ id: number }>,
    now: Date,
  ): Promise<void> {
    const sessionIds = sessions.map((session) => session.id);

    await tx.scanOrderingCartItem.updateMany({
      where: { sessionId: { in: sessionIds }, status: 'active' },
      data: { status: 'removed' },
    });
    await tx.scanOrderingSession.updateMany({
      where: { id: { in: sessionIds }, status: { in: ['active', 'left'] } },
      data: { status: 'checked_out', endedAt: now, archiveReason: 'cleared' },
    });
    // 完结已出餐订单：扫码会话内订单 + 该桌手工单（手工单 sessionId=null，须单独更新）
    await tx.scanOrders.updateMany({
      where: {
        sessionId: { in: sessionIds },
        deletedAt: null,
        status: 'served',
      },
      data: { status: 'completed', completedAt: now },
    });
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
    await tx.scanOrderingTable.update({
      where: { id: tableId },
      data: { status: 'empty', version: { increment: 1 } },
    });
  }
}
