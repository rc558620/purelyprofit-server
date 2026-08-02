import { Injectable } from '@nestjs/common';
import { ScanOrderStatus, ScanOrderingSessionStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import type { ListClubScanOrdersQueryDto } from './dto/club-scan-ordering.dto';

@Injectable()
export class ClubScanOrderingOrderQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async listOrders(
    user: AuthenticatedUser,
    query: ListClubScanOrdersQueryDto,
  ): Promise<unknown> {
    // 默认只显示进行中的订单（如果没有指定 status 过滤）
    // 进行中状态包括：pending_payment, pending_acceptance, preparing, served
    const activeStates = [
      ScanOrderStatus.pending_payment,
      ScanOrderStatus.pending_acceptance,
      ScanOrderStatus.preparing,
      ScanOrderStatus.served,
    ];

    const take = (query.limit ?? 20) + 1;
    const sessions = await this.prisma.scanOrderingSession.findMany({
      where: {
        clubUserId: user.id,
        // left 会话本身不是当前会话；但同一用户在同桌仍有有效 active 会话时，
        // left 中的待履约订单仍属于当前用餐轮次，不能同时从当前订单和历史记录遗漏。
        OR: [
          {
            status: ScanOrderingSessionStatus.active,
            expiresAt: { gt: new Date() },
            deletedAt: null,
          },
          {
            status: ScanOrderingSessionStatus.left,
            table: {
              sessions: {
                some: {
                  clubUserId: user.id,
                  status: ScanOrderingSessionStatus.active,
                  deletedAt: null,
                  expiresAt: { gt: new Date() },
                },
              },
            },
          },
        ],
        ...(query.cursor ? { id: { lt: query.cursor } } : {}),
      },
      orderBy: [{ lastActiveAt: 'desc' }, { id: 'desc' }],
      take,
      select: {
        id: true,
        storeId: true,
        guestCount: true,
        status: true,
        createdAt: true,
        lastActiveAt: true,
        table: {
          select: {
            id: true,
            tableCode: true,
            name: true,
            area: { select: { name: true } },
            type: { select: { name: true } },
          },
        },
        orders: {
          where: {
            deletedAt: null,
            ...(query.status
              ? { status: query.status as ScanOrderStatus }
              : {
                  OR: [
                    { status: { in: activeStates } },
                    // 已退款不再参与桌台履约或清桌校验，但顾客在本次有效用餐
                    // 会话中仍需能查看退款结果并继续点餐。
                    {
                      status: ScanOrderStatus.rejected,
                      paymentStatus: 'refunded',
                    },
                  ],
                }),
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: {
            id: true,
            orderNo: true,
            status: true,
            paymentStatus: true,
            fulfillmentStatus: true,
            payableAmount: true,
            paidAmount: true,
            remark: true,
            createdAt: true,
            paymentExpiresAt: true,
            acceptedAt: true,
            paymentAttempts: {
              where: { status: { in: ['succeeded', 'refunded'] } },
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: { paymentChannel: true },
            },
            refundTasks: {
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: {
                status: true,
                refundSucceededAt: true,
                processedAt: true,
                triggeredAt: true,
              },
            },
            balanceTransactions: {
              where: { type: 'refund' },
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: { createdAt: true },
            },
            items: {
              orderBy: { sortOrder: 'asc' },
              select: {
                menuProductId: true,
                productNameSnapshot: true,
                productImageUrlSnapshot: true,
                quantity: true,
                specs: {
                  orderBy: { id: 'asc' },
                  select: { specOptionNameSnapshot: true },
                },
              },
            },
          },
        },
      },
    });
    const menuProductIds = sessions.flatMap((session) =>
      session.orders.flatMap((order) =>
        order.items.map((item) => item.menuProductId),
      ),
    );
    const menuProducts = await this.prisma.scanOrderingMenuProduct.findMany({
      where: { id: { in: menuProductIds } },
      select: {
        id: true,
        imageUrl: true,
        product: { select: { image: true } },
      },
    });
    const imageByMenuProductId = new Map(
      menuProducts.map((product) => [
        product.id,
        product.product?.image ?? product.imageUrl,
      ]),
    );
    const hydratedSessions = sessions.map((session) => ({
      ...session,
      orders: session.orders.map((order) => ({
        ...order,
        items: order.items.map((item) => ({
          ...item,
          productImageUrlSnapshot:
            item.productImageUrlSnapshot ??
            imageByMenuProductId.get(item.menuProductId) ??
            null,
        })),
      })),
    }));
    const hasMore = hydratedSessions.length === take;
    const items = hydratedSessions
      .slice(0, hasMore ? -1 : undefined)
      .filter((session) => session.orders.length > 0);
    return {
      items: items.map((session) => ({
        ...session,
        createdAt: session.createdAt.toISOString(),
        lastActiveAt: session.lastActiveAt.toISOString(),
        orders: session.orders.map((order) => ({
          ...order,
          createdAt: order.createdAt.toISOString(),
          paymentExpiresAt: order.paymentExpiresAt?.toISOString() ?? null,
          acceptedAt: order.acceptedAt?.toISOString() ?? null,
          refundTasks: order.refundTasks.map((task) => ({
            ...task,
            refundSucceededAt:
              task.refundSucceededAt?.toISOString() ??
              task.processedAt?.toISOString() ??
              task.triggeredAt?.toISOString() ??
              order.balanceTransactions[0]?.createdAt.toISOString() ??
              null,
          })),
          balanceTransactions: order.balanceTransactions.map((transaction) => ({
            createdAt: transaction.createdAt.toISOString(),
          })),
        })),
      })),
      nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
    };
  }
}
