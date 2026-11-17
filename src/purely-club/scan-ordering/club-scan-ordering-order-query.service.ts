import { Injectable, NotFoundException } from '@nestjs/common';
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
  CLUB_SCAN_ORDERING_ERROR_CODE,
  clubScanOrderingError,
} from './club-scan-ordering.errors';
import {
  SCAN_ORDER_DETAIL_INCLUDE,
  fenToYuan,
  toOrderAmountSummary,
  toScanOrderDetailResponse,
} from './club-scan-ordering-order.mapper';

/** 在途订单状态：只要会话里还有这些订单，这一轮用餐就还没结束 */
const IN_FLIGHT_ORDER_STATUSES: ScanOrderStatus[] = [
  ScanOrderStatus.pending_payment,
  ScanOrderStatus.pending_acceptance,
  ScanOrderStatus.preparing,
  ScanOrderStatus.served,
];

/** 轮次复用窗口：与 upsertSession 复用 diningRoundId 的时间窗口同口径 */
const ACTIVE_ROUND_WINDOW_MS = 4 * 60 * 60 * 1000;

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
export function buildCurrentRoundSessionWhere(
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

export interface SessionVisibilityFilterInput {
  now: Date;
  /** 当前有效 active 会话所属的用餐轮次 id（独立查询得到的集合） */
  activeDiningRoundIds: readonly string[];
  /** 轮次复用窗口（毫秒），默认 4h */
  activeRoundWindowMs?: number;
}

/**
 * 追踪页「可见会话」的 3 个 OR 分支，抽成纯函数便于逐分支断言。
 *
 * 三个分支互不替代，任何一条被删都会造成真实的订单丢失 / 回流：
 * 1. 当前轮次的 active 会话（未过期，或已过期但仍有在途订单）；
 * 2. 同轮次的 left 会话（客户离桌后又回来继续点，仍在 4h 复用窗口内）；
 * 3. 跨轮次但仍有未闭环订单的 left 会话（served 单既不算当前轮次、
 *    也进不了历史接口，不清就会「订单消失」）。
 */
export function buildSessionVisibilityWhere(
  input: SessionVisibilityFilterInput,
): Prisma.ScanOrderingSessionWhereInput {
  const { now, activeDiningRoundIds } = input;
  const activeRoundWindowMs =
    input.activeRoundWindowMs ?? ACTIVE_ROUND_WINDOW_MS;

  return {
    // left 会话本身不是当前会话；但同一用户在同桌仍有有效 active 会话时，
    // left 中的待履约订单仍属于当前用餐轮次，不能同时从当前订单和历史记录遗漏。
    // 同时要求 left 会话最近仍活跃（lastActiveAt 落在窗口内），避免跨天清桌后
    // 旧会话的退款/历史订单重新出现在新一轮订单详情中。
    OR: [
      // 分支 1：当前轮次的 active 会话
      buildCurrentRoundSessionWhere(now),
      // 分支 2：同轮次的 left 会话（必须与「当前有效轮次」交集为空则不命中）
      {
        status: ScanOrderingSessionStatus.left,
        lastActiveAt: {
          gte: new Date(now.getTime() - activeRoundWindowMs),
        },
        diningRoundId: { in: [...activeDiningRoundIds] },
      },
      // 分支 3：跨轮次但仍有未闭环订单的 left 会话。顾客重新扫码时，若旧会话
      // lastActiveAt 超出 upsertSession 的轮次复用窗口，会开出新 diningRoundId，
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
  };
}

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
        ...buildCurrentRoundSessionWhere(new Date()),
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

    const take = (query.limit ?? 20) + 1;
    // 轮次 ID 单独先取：它依赖「当前有效 active 会话」，是本次请求的第 1 次往返。
    // 显式提出来而不是写在 where 字面量里，避免把一次 IO 藏在条件构造中。
    //
    // 为什么没把它并进主查询：Prisma 的类型化 where 不支持相关子查询，而分支 2
    // 的条件是「本会话的 diningRoundId ∈ 当前用户 active 会话的 diningRoundId」，
    // 属自连接半连接语义。合并只能把整段（含 orders/items/specs 嵌套 select 的）
    // 会话查询改成原生 SQL —— 3 个 OR 分支的等价性会从「结构等价」退化成
    // 「人工比对 SQL」，风险远高于省下的这一跳。
    // 追踪页真正省下来的一跳是菜单商品图片查询（原先单独 findMany 一次），
    // 现已并入主查询的 items 嵌套 select，30s 轮询往返 3 → 2。
    const activeDiningRoundIds = await this.activeDiningRoundIds(user.id);
    const sessions = await this.prisma.scanOrderingSession.findMany({
      where: {
        clubUserId: user.id,
        ...buildSessionVisibilityWhere({ now, activeDiningRoundIds }),
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
                // 图片兜底随明细一起取回（to-one 关系走 JOIN，不额外往返）：
                // 原先整页明细还要再单独 findMany 一次菜单商品图片，追踪页
                // 30s 轮询时这一跳是纯浪费。映射后会把该字段剔除，不进响应体。
                menuProduct: {
                  select: {
                    imageUrl: true,
                    product: { select: { image: true } },
                  },
                },
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
    // 只处理当前页：hasMore 时末条仅用于游标探测；没有在途订单的会话不返回。
    const hasMore = sessions.length === take;
    const visibleSessions = (hasMore ? sessions.slice(0, -1) : sessions).filter(
      (session) => session.orders.length > 0,
    );

    // 金额统一在后端换算为「元」，前端只负责展示。
    // 这里单趟完成「会话 → 订单 → 明细」的映射：原实现先深拷贝出 hydratedSessions
    // 再整体 map 一次，同一批行会分配两份对象，追踪页 30s 轮询时被成倍放大。
    const items = visibleSessions.map((session) => ({
      ...session,
      createdAt: session.createdAt.toISOString(),
      lastActiveAt: session.lastActiveAt.toISOString(),
      orders: session.orders.map((order) => {
        // 营销快照只用于金额派生（积分抵扣 / 优惠清单），前端零消费：
        // 追踪页每 30s 轮询一次，剔除后单次响应体积可降约 2/3
        const { marketingSnapshot: _marketingSnapshot, ...orderColumns } =
          order;
        return {
          ...orderColumns,
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
          balanceTransactions: order.balanceTransactions.map((transaction) => ({
            createdAt: transaction.createdAt.toISOString(),
          })),
          items: order.items.map((item) => {
            // menuProduct 只用于取图片兜底，不进响应体
            const { menuProduct, ...itemColumns } = item;
            return {
              ...itemColumns,
              unitPriceAmount: fenToYuan(item.unitPriceAmount),
              lineTotalAmount: fenToYuan(item.lineTotalAmount),
              payableLineAmount: fenToYuan(item.payableLineAmount),
              productImageUrlSnapshot:
                item.productImageUrlSnapshot ??
                menuProduct?.product?.image ??
                menuProduct?.imageUrl ??
                null,
            };
          }),
        };
      }),
    }));

    return {
      items,
      nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
    };
  }

  /**
   * 订单详情：明细 + 最新支付 / 退款 / 余额流水。
   * clubUserId 参与过滤，他人的订单一律按「不存在」处理，不泄露存在性。
   */
  async getOrder(user: AuthenticatedUser, orderId: number): Promise<unknown> {
    const order = await this.prisma.scanOrders.findFirst({
      where: { id: orderId, clubUserId: user.id, deletedAt: null },
      include: SCAN_ORDER_DETAIL_INCLUDE,
    });
    if (!order)
      throw new NotFoundException(
        clubScanOrderingError(
          CLUB_SCAN_ORDERING_ERROR_CODE.RESOURCE_ORDER_NOT_FOUND,
          '订单不存在',
        ),
      );
    return toScanOrderDetailResponse(
      order,
      this.pickupNumberService.formatPickupNumber(order.pickupNumber),
    );
  }
}
