import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
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
                        status: { in: ['pending_payment', 'pending_acceptance', 'preparing', 'served'] },
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

    return tables.map((table) => {
      const now = new Date();
      const activeSessions = table.sessions.filter(
        (session) => session.status === 'active'
          && (session.expiresAt > now || session.orders.length > 0),
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

      return {
        id: table.id,
        tableCode: table.tableCode,
        name: table.name,
        status:
          table.status === 'disabled'
            ? 'disabled'
            : activeSession
              ? 'dining'
              : 'empty',
        activeOrderCount: activeOrders.length,
        guestCount,
        activeSession: activeSession
          ? {
              id: activeSession.id,
              startedAt: activeSession.createdAt.toISOString(),
              guestCount,
              status: activeSession.status,
            }
          : null,
        clearability: {
          canClear: activeSession !== null && blockingOrderCount === 0,
          blockingOrderCount,
          reason:
            activeSession === null
              ? '当前为空桌'
              : blockingOrderCount > 0
                ? `当前仍有 ${blockingOrderCount} 笔订单未出餐，全部出餐后才可清桌`
                : null,
        },
        activeOrders: activeOrders.map((order) => ({
          id: order.id,
          orderNo: order.orderNo,
          status: order.status,
          paymentStatus: order.paymentStatus,
          fulfillmentStatus: order.fulfillmentStatus,
          totalAmount: order.payableAmount,
          createdAt: order.createdAt.toISOString(),
        })),
        areaId: table.areaId,
        areaName: table.area?.name ?? null,
        typeId: table.typeId,
        typeName: table.type?.name ?? null,
      };
    });
  }
}
