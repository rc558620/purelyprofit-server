import { Injectable } from '@nestjs/common';
import { ScanOrderStatus, ScanOrderingSessionStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { ScanOrderingPickupNumberService } from './scan-ordering-pickup-number.service';
import type { ListClubScanOrdersQueryDto } from './dto/club-scan-ordering.dto';
import {
  fenToYuan,
  toOrderAmountSummary,
} from './club-scan-ordering-order.mapper';

@Injectable()
export class ClubScanOrderingOrderQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pickupNumberService: ScanOrderingPickupNumberService,
  ) {}

  private async activeDiningRoundIds(clubUserId: number): Promise<string[]> {
    const sessions = await this.prisma.scanOrderingSession.findMany({
      where: {
        clubUserId,
        status: ScanOrderingSessionStatus.active,
        deletedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { diningRoundId: true },
    });
    return sessions.map((session) => session.diningRoundId);
  }

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
            diningRoundId: {
              in: await this.activeDiningRoundIds(user.id),
            },
          },
        ],
        ...(query.cursor ? { id: { lt: query.cursor } } : {}),
      },
      orderBy: [{ lastActiveAt: 'desc' }, { id: 'desc' }],
      take,
      select: {
        id: true,
        diningRoundId: true,
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
            itemOriginalAmount: true,
            specificationExtraAmount: true,
            productDiscountAmount: true,
            orderDiscountAmount: true,
            marketingSnapshot: true,
            remark: true,
            createdAt: true,
            paymentExpiresAt: true,
            acceptedAt: true,
            pickupNumber: true,
            pickupBusinessDate: true,
            pickupNumberStatus: true,
            pickupCalledAt: true,
            pickupCompletedAt: true,
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
                // 暴露金额字段用于订单详情规格样式展示。
                unitPriceAmount: true,
                lineTotalAmount: true,
                payableLineAmount: true,
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
    // 金额统一在后端换算为「元」，前端只负责展示。
    const hydratedSessions = sessions.map((session) => ({
      ...session,
      orders: session.orders.map((order) => ({
        ...order,
        items: order.items.map((item) => ({
          ...item,
          unitPriceAmount: fenToYuan(item.unitPriceAmount),
          lineTotalAmount: fenToYuan(item.lineTotalAmount),
          payableLineAmount: fenToYuan(item.payableLineAmount),
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
        orders: session.orders.map((order) => {
          const { marketingSnapshot: _marketingSnapshot, ...orderFields } =
            order;
          return {
            ...orderFields,
            ...toOrderAmountSummary(order),
            pickupNumberLabel: this.pickupNumberService.formatPickupNumber(
              order.pickupNumber,
            ),
            pickupCalledAt: order.pickupCalledAt?.toISOString() ?? null,
            pickupCompletedAt: order.pickupCompletedAt?.toISOString() ?? null,
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
            balanceTransactions: order.balanceTransactions.map(
              (transaction) => ({
                createdAt: transaction.createdAt.toISOString(),
              }),
            ),
          };
        }),
      })),
      nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
    };
  }
}
