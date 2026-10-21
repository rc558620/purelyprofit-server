import { Injectable } from '@nestjs/common';
import {
  Prisma,
  ScanOrderStatus,
  ScanOrderingSessionStatus,
} from '@prisma/client';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { ScanOrderingPickupNumberService } from './scan-ordering-pickup-number.service';
import type { ListClubScanOrdersQueryDto } from './dto/club-scan-ordering.dto';
import {
  fenToYuan,
  toOrderAmountSummary,
} from './club-scan-ordering-order.mapper';

/** 在途订单状态：只要会话里还有这些订单，这一轮用餐就还没结束 */
const IN_FLIGHT_ORDER_STATUSES: ScanOrderStatus[] = [
  ScanOrderStatus.pending_payment,
  ScanOrderStatus.pending_acceptance,
  ScanOrderStatus.preparing,
  ScanOrderStatus.served,
];

@Injectable()
export class ClubScanOrderingOrderQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pickupNumberService: ScanOrderingPickupNumberService,
  ) {}

  /**
   * 「当前用餐轮次」的 active 会话口径：未过期，或虽然已过期但仍有在途订单。
   *
   * 会话 TTL（SESSION_TTL_MS = 4h）只限制 C 端继续点餐，不能让在途订单凭空消失：
   * - `getCurrentSession`（继续点餐）本就是这个口径；
   * - 商家端桌台查询同样认可「已过期 + 有在途订单」的 active 会话，
   *   并注明「不能让待接单/制作中订单变成空桌」。
   * 只有订单列表此前用 `expiresAt > now` 一刀切，导致扫码超过 TTL 后顾客端
   * 订单追踪页看不到仍在制作的订单，商家端却仍占用桌台。
   */
  private currentRoundSessionWhere(
    now: Date,
  ): Prisma.ScanOrderingSessionWhereInput {
    return {
      status: ScanOrderingSessionStatus.active,
      deletedAt: null,
      OR: [
        { expiresAt: { gt: now } },
        {
          orders: {
            some: {
              deletedAt: null,
              status: { in: IN_FLIGHT_ORDER_STATUSES },
            },
          },
        },
      ],
    };
  }

  private async activeDiningRoundIds(clubUserId: number): Promise<string[]> {
    const sessions = await this.prisma.scanOrderingSession.findMany({
      where: {
        clubUserId,
        ...this.currentRoundSessionWhere(new Date()),
      },
      select: { diningRoundId: true },
    });
    return sessions.map((session) => session.diningRoundId);
  }

  async listOrders(
    user: AuthenticatedUser,
    query: ListClubScanOrdersQueryDto,
  ): Promise<unknown> {
    const now = new Date();

    // 与 upsertSession 复用 diningRoundId 的时间窗口同口径：
    // 只会话活跃时间落在该窗口内的 left 会话才属于当前用餐轮次。
    // 兜底历史脏关联——旧会话若在窗口外被复用为当前轮次（见 upsertSession），
    // 此处不会把其订单再并入当前订单详情。
    const activeRoundWindowMs = 4 * 60 * 60 * 1000;

    const take = (query.limit ?? 20) + 1;
    // 轮次 ID 单独先取：它依赖「当前有效 active 会话」，是本次请求的第 1 次往返。
    // 显式提出来而不是写在 where 字面量里，避免把一次 IO 藏在条件构造中。
    const activeDiningRoundIds = await this.activeDiningRoundIds(user.id);
    const sessions = await this.prisma.scanOrderingSession.findMany({
      where: {
        clubUserId: user.id,
        // left 会话本身不是当前会话；但同一用户在同桌仍有有效 active 会话时，
        // left 中的待履约订单仍属于当前用餐轮次，不能同时从当前订单和历史记录遗漏。
        // 同时要求 left 会话最近仍活跃（lastActiveAt 落在窗口内），避免跨天清桌后
        // 旧会话的退款/历史订单重新出现在新一轮订单详情中。
        OR: [
          this.currentRoundSessionWhere(now),
          {
            status: ScanOrderingSessionStatus.left,
            lastActiveAt: {
              gte: new Date(now.getTime() - activeRoundWindowMs),
            },
            diningRoundId: { in: activeDiningRoundIds },
          },
          // 跨轮次但仍有未闭环订单的 left 会话：顾客重新扫码时，若旧会话 lastActiveAt
          // 超出 upsertSession 的轮次复用窗口，会开出新 diningRoundId（新轮次），
          // 旧轮次会话随即不满足上面的「同轮次」条件。而旧轮次里的 served 单既不属于
          // 当前轮次（不会出现在当前订单），又因 served 非终态进不了历史接口
          // —— 顾客重扫后订单直接「消失」（真实故障：A01 凌晨订单不见了）。
          // 这里把它们并入当前订单，直到自动归档把 served 闭环为 completed。
          // 终态订单（已退款/已完成/已取消）不受影响，仍受上面窗口限制，避免跨天回流。
          {
            status: ScanOrderingSessionStatus.left,
            orders: {
              some: {
                deletedAt: null,
                status: { in: IN_FLIGHT_ORDER_STATUSES },
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
                    { status: { in: IN_FLIGHT_ORDER_STATUSES } },
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
            // 乐观锁版本：待支付订单在追踪页「继续支付」时要原样带回
            version: true,
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
          return {
            ...order,
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
