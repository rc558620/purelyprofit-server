import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { getShanghaiDayStartMs } from '../../../shared/shanghai-time.utils';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import type { ScanOrderingTableResponse } from './scan-ordering-table.service';

@Injectable()
export class ScanOrderingTableQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
  ) {}

  async listTables(
    user: AuthenticatedUser,
  ): Promise<ScanOrderingTableResponse[]> {
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      'scan-ordering:view',
      '无权操作扫码点餐桌台',
    );

    const tables = await this.prisma.scanOrderingTable.findMany({
      where: { storeId, deletedAt: null },
      orderBy: [{ areaId: 'asc' }, { tableCode: 'asc' }, { id: 'asc' }],
      include: {
        area: { select: { name: true } },
        type: { select: { name: true } },
        sessions: {
          // left 会话属于清桌前的同一轮用餐，即使软删除仍要保留其待履约订单。
          // active 会话必须有效，过期会话不应继续占用桌台。
          where: {
            // 只要当前 active 会话还有未完成履约订单，就必须继续占用桌台。
            // 会话 TTL 仅限制 C 端继续点餐，不能让待接单/制作中订单变成“空桌”。
            OR: [
              { status: 'left' },
              {
                status: 'active',
                deletedAt: null,
                OR: [
                  { expiresAt: { gt: new Date() } },
                  {
                    orders: {
                      some: {
                        deletedAt: null,
                        status: {
                          in: [
                            'pending_payment',
                            'pending_acceptance',
                            'preparing',
                            'served',
                          ],
                        },
                      },
                    },
                  },
                ],
              },
            ],
          },
          orderBy: [{ lastActiveAt: 'desc' }, { id: 'desc' }],
          select: {
            id: true,
            createdAt: true,
            expiresAt: true,
            guestCount: true,
            status: true,
            orders: {
              where: {
                deletedAt: null,
                status: {
                  in: [
                    'pending_payment',
                    'pending_acceptance',
                    'preparing',
                    'served',
                  ],
                },
              },
              orderBy: { createdAt: 'desc' },
              select: {
                id: true,
                orderNo: true,
                status: true,
                paymentStatus: true,
                fulfillmentStatus: true,
                guestCount: true,
                payableAmount: true,
                createdAt: true,
              },
            },
          },
        },
      },
    });

    // 预解析各桌有效 active 会话起点；手工补录单查询覆盖全部桌台（含无扫码会话的空桌，
    // 空桌上的堂食录入单构成独立「录入轮次」），时间窗口取会话起点与当日上海营业日开始的较小值
    const now = new Date();
    const dayStart = new Date(getShanghaiDayStartMs(now.getTime()));
    const sessionStarts = tables
      .map((table) => ({
        tableId: table.id,
        startAt: this.resolveActiveSessionStart(table.sessions, now),
      }))
      .filter(
        (item): item is { tableId: number; startAt: Date } =>
          item.startAt !== null,
      );
    const earliestSessionStart = sessionStarts
      .map((item) => item.startAt)
      .reduce<Date>(
        (min, startAt) => (startAt < min ? startAt : min),
        dayStart,
      );
    const manualOrdersByTable = await this.loadManualEntryOrders(
      storeId,
      tables.map((table) => table.id),
      earliestSessionStart,
    );

    return tables.map((table) => {
      const activeSessions = table.sessions.filter(
        (session) =>
          session.status === 'active' &&
          (session.expiresAt > now || session.orders.length > 0),
      );
      const activeSession = activeSessions[0] ?? null;
      // left 会话不能单独恢复已清空桌台：它只有在存在有效 active 会话时，
      // 才作为同一轮次的一部分参与订单汇总与清桌校验。
      const currentRoundSessions = activeSession ? table.sessions : [];
      const activeOrders = currentRoundSessions.flatMap(
        (session) => session.orders,
      );
      const fulfillmentOrders = activeOrders;
      const guestCount = activeOrders.reduce(
        (total, order) => total + (order.guestCount ?? 0),
        0,
      );
      const allOrdersServed =
        fulfillmentOrders.length > 0 &&
        fulfillmentOrders.every(
          (order) =>
            order.status === 'served' || order.fulfillmentStatus === 'served',
        );
      const blockingOrderCount = allOrdersServed
        ? 0
        : fulfillmentOrders.filter(
            (order) =>
              order.status !== 'served' && order.fulfillmentStatus !== 'served',
          ).length;

      // 手工补录单归桌展示：统一取当日上海营业日开始（loadManualEntryOrders 查询下限
      // 已是 earliestSessionStart = min(会话开始, 当日开始)，此处不再按会话创建时间过滤，
      // 避免「先录单、后扫码下单」场景（会话晚于录入单创建）导致录入单被隐藏。
      // clearability/清桌阻塞仍以扫码订单为准，已完结的补录单不阻塞清桌。
      const entryWindowStart = dayStart;
      const tableManualOrders = (
        manualOrdersByTable.get(table.id) ?? []
      ).filter((order) => order.createdAt >= entryWindowStart);
      const manualEntryOrders = tableManualOrders.map((order) => ({
        id: `manual-${order.id}` as number | string,
        orderNo: order.orderNo,
        status: order.status,
        paymentStatus: 'paid',
        fulfillmentStatus: order.fulfillmentStatus,
        totalAmount: order.totalAmount,
        createdAt: order.createdAt.toISOString(),
        manualEntry: true,
      }));
      // 纯录入轮次（无扫码会话但有当日录入单）：合成会话展示入座时间与合计人数
      const manualGuestCount = tableManualOrders.reduce(
        (total, order) => total + (order.guestCount ?? 0),
        0,
      );
      const displayGuestCount = activeSession ? guestCount : manualGuestCount;
      const manualFirstOrderAt = tableManualOrders.reduce<Date | null>(
        (earliest, order) =>
          earliest === null || order.createdAt < earliest
            ? order.createdAt
            : earliest,
        null,
      );
      const hasEntryRound = manualEntryOrders.length > 0;

      return {
        id: table.id,
        tableCode: table.tableCode,
        name: table.name,
        status:
          table.status === 'disabled'
            ? 'disabled'
            : activeSession || hasEntryRound
              ? 'dining'
              : 'empty',
        activeOrderCount: activeOrders.length + manualEntryOrders.length,
        guestCount: displayGuestCount,
        activeSession: activeSession
          ? {
              id: activeSession.id,
              startedAt: activeSession.createdAt.toISOString(),
              guestCount,
              status: activeSession.status,
            }
          : hasEntryRound && manualFirstOrderAt !== null
            ? {
                id: `manual-session-${table.id}` as number | string,
                startedAt: manualFirstOrderAt.toISOString(),
                guestCount: manualGuestCount,
                status: 'active',
              }
            : null,
        clearability: {
          canClear:
            (activeSession !== null || hasEntryRound) &&
            blockingOrderCount === 0,
          blockingOrderCount,
          reason:
            activeSession === null && !hasEntryRound
              ? '当前为空桌'
              : blockingOrderCount > 0
                ? `当前仍有 ${blockingOrderCount} 笔订单未出餐，全部出餐后才可清桌`
                : null,
        },
        // 会话内订单统一按创建时间倒序（扫码单与手工补录单混排）
        activeOrders: [
          ...activeOrders.map((order) => ({
            id: order.id,
            orderNo: order.orderNo,
            status: order.status,
            paymentStatus: order.paymentStatus,
            fulfillmentStatus: order.fulfillmentStatus,
            totalAmount: order.payableAmount,
            createdAt: order.createdAt.toISOString(),
          })),
          ...manualEntryOrders,
        ].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
        areaId: table.areaId,
        areaName: table.area?.name ?? null,
        typeId: table.typeId,
        typeName: table.type?.name ?? null,
      };
    });
  }

  /** 解析桌台有效 active 会话的开始时间（无有效会话为 null），与展示层判定同口径。 */
  private resolveActiveSessionStart(
    sessions: Array<{
      status: string;
      createdAt: Date;
      expiresAt: Date;
      orders: unknown[];
    }>,
    now: Date,
  ): Date | null {
    const activeSession = sessions.find(
      (session) =>
        session.status === 'active' &&
        (session.expiresAt > now || session.orders.length > 0),
    );
    return activeSession ? activeSession.createdAt : null;
  }

  /**
   * 一次性拉取各桌手工补录单，按桌台分组返回；覆盖全部桌台（含无扫码会话的空桌，
   * 由调用方按各自轮次窗口归并），select 携带人数供录入轮次合计。
   * 同时查询 scan_orders（新链路）和 saleOrder（老数据兜底），统一返回结构。
   */
  private async loadManualEntryOrders(
    storeId: number,
    tableIds: number[],
    earliestStart: Date,
  ): Promise<
    Map<
      number,
      Array<{
        id: number;
        orderNo: string;
        status: string;
        fulfillmentStatus: string;
        totalAmount: number;
        guestCount: number | null;
        createdAt: Date;
      }>
    >
  > {
    if (tableIds.length === 0) return new Map();
    const grouped = new Map<
      number,
      Array<{
        id: number;
        orderNo: string;
        status: string;
        fulfillmentStatus: string;
        totalAmount: number;
        guestCount: number | null;
        createdAt: Date;
      }>
    >();

    // 新链路：scan_orders 手工单（走状态机，显示真实状态）
    const newManualOrders = await this.prisma.scanOrders.findMany({
      where: {
        storeId,
        manualEntry: true,
        tableId: { in: tableIds },
        createdAt: { gte: earliestStart },
        status: {
          in: ['pending_acceptance', 'preparing', 'served', 'completed'],
        },
      },
      select: {
        id: true,
        orderNo: true,
        status: true,
        fulfillmentStatus: true,
        payableAmount: true,
        guestCount: true,
        createdAt: true,
        tableId: true,
      },
    });
    for (const order of newManualOrders) {
      if (order.tableId === null) continue;
      const list = grouped.get(order.tableId) ?? [];
      list.push({
        id: order.id,
        orderNo: order.orderNo,
        status: order.status,
        fulfillmentStatus: order.fulfillmentStatus,
        totalAmount: order.payableAmount,
        guestCount: order.guestCount,
        createdAt: order.createdAt,
      });
      grouped.set(order.tableId, list);
    }

    // 老数据兜底：改造前已落 SaleOrder 的手工补录单（状态固定为 completed）
    const oldManualOrders = await this.prisma.saleOrder.findMany({
      where: {
        storeId,
        manualEntry: true,
        diningTableId: { in: tableIds },
        createdAt: { gte: earliestStart },
      },
      select: {
        id: true,
        orderNo: true,
        totalRevenue: true,
        guestCount: true,
        createdAt: true,
        diningTableId: true,
      },
    });
    for (const order of oldManualOrders) {
      if (order.diningTableId === null) continue;
      // 避免新老数据重复（以 orderNo 去重）
      const existingNos =
        grouped.get(order.diningTableId)?.map((o) => o.orderNo) ?? [];
      if (existingNos.includes(order.orderNo)) continue;
      const list = grouped.get(order.diningTableId) ?? [];
      list.push({
        id: order.id,
        orderNo: order.orderNo,
        status: 'completed',
        fulfillmentStatus: 'served',
        totalAmount: order.totalRevenue,
        guestCount: order.guestCount,
        createdAt: order.createdAt,
      });
      grouped.set(order.diningTableId, list);
    }

    return grouped;
  }
}
