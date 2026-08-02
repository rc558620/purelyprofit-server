import { Injectable } from '@nestjs/common';
import { ScanOrderingSessionStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import type { ListClubScanOrdersQueryDto } from './dto/club-scan-ordering.dto';

@Injectable()
export class ClubScanOrderingOrderHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  async listOrderHistory(
    user: AuthenticatedUser,
    query: ListClubScanOrdersQueryDto,
  ): Promise<unknown> {
    const take = (query.limit ?? 20) + 1;
    const sessions = await this.prisma.scanOrderingSession.findMany({
      where: {
        clubUserId: user.id,
        // 历史记录必须包含清桌的 checked_out 会话，以及重新扫码时标记为
        // left（同时可能软删除）的会话；否则已支付订单会从两处列表都消失。
        status: {
          in: [
            ScanOrderingSessionStatus.checked_out,
            ScanOrderingSessionStatus.expired,
            ScanOrderingSessionStatus.left,
          ],
        },
        ...(query.cursor ? { id: { lt: query.cursor } } : {}),
      },
      orderBy: { id: 'desc' },
      take,
      select: {
        id: true,
        storeId: true,
        guestCount: true,
        status: true,
        createdAt: true,
        endedAt: true,
        archiveReason: true,
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
          where: { deletedAt: null },
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
            servedAt: true,
            paymentAttempts: {
              where: { status: { in: ['succeeded', 'refunded'] } },
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: { paymentChannel: true },
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
      // left 仅代表顾客离开页面。只有真正结束的订单才进入历史；待接单、
      // 制作中和已出餐订单仍属于当前桌台履约范围。
      orders: session.orders
        .filter(
          (order) =>
            session.status !== ScanOrderingSessionStatus.left ||
            ['rejected', 'cancelled', 'completed'].includes(order.status),
        )
        .map((order) => ({
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
    const items = (
      hasMore ? hydratedSessions.slice(0, -1) : hydratedSessions
    ).filter((session) => session.orders.length > 0);
    return {
      items: items.map((session) => ({
        ...session,
        createdAt: session.createdAt.toISOString(),
        endedAt: session.endedAt?.toISOString() ?? null,
        orders: session.orders.map((order) => ({
          ...order,
          createdAt: order.createdAt.toISOString(),
          servedAt: order.servedAt?.toISOString() ?? null,
          paymentAttempts: order.paymentAttempts,
          refundTasks: order.refundTasks.map((task) => ({
            ...task,
            refundSucceededAt:
              task.refundSucceededAt?.toISOString() ??
              task.processedAt?.toISOString() ??
              task.triggeredAt.toISOString() ??
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
