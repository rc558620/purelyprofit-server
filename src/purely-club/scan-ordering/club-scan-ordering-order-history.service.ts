import { Injectable } from '@nestjs/common';
import { ScanOrderingSessionStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { ClubCurrentStoreContextService } from '../stores/club-current-store-context.service';
import { ScanOrderingPickupNumberService } from './scan-ordering-pickup-number.service';
import type { ListClubScanOrdersQueryDto } from './dto/club-scan-ordering.dto';
import {
  fenToYuan,
  toOrderAmountSummary,
} from './club-scan-ordering-order.mapper';
import {
  CLUB_ORDER_HISTORY_MAX_ITEMS_PER_ORDER,
  CLUB_ORDER_HISTORY_MAX_ORDERS_PER_SESSION,
  CLUB_ORDER_HISTORY_SESSION_SELECT,
  type ClubOrderHistoryItemResponse,
  type ClubOrderHistoryItemRow,
  type ClubOrderHistoryOrderResponse,
  type ClubOrderHistoryOrderRow,
  type ClubOrderHistoryResponse,
  type ClubOrderHistorySessionResponse,
  type ClubOrderHistorySessionRow,
} from './club-scan-ordering-order-history.types';

/**
 * left 会话只展示真正结束的订单：顾客离开页面不代表订单结束，
 * 待接单 / 制作中 / 已出餐仍属于当前桌台履约范围。
 */
const LEFT_SESSION_HISTORY_ORDER_STATUS = new Set<string>([
  'rejected',
  'cancelled',
  'completed',
]);

/**
 * 合并同轮次订单时的全序比较器。
 *
 * `createdAt` 相同的订单由 `id` 兜底，因此结果是唯一确定的（与输入顺序无关），
 * 保证「按 createdAt + id 稳定排序」的语义在合并前后一致。
 */
const compareHistoryOrders = (
  left: ClubOrderHistoryOrderRow,
  right: ClubOrderHistoryOrderRow,
): number =>
  right.createdAt.getTime() - left.createdAt.getTime() || right.id - left.id;

@Injectable()
export class ClubScanOrderingOrderHistoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pickupNumberService: ScanOrderingPickupNumberService,
    private readonly currentStoreContextService: ClubCurrentStoreContextService,
  ) {}

  async listOrderHistory(
    user: AuthenticatedUser,
    query: ListClubScanOrdersQueryDto,
  ): Promise<ClubOrderHistoryResponse> {
    const take = (query.limit ?? 20) + 1;
    // 点餐记录按用户当前门店过滤：切换门店后只展示当前门店的历史会话，
    // 与自助下单等模块的当前门店上下文约定保持一致
    const currentStore =
      await this.currentStoreContextService.getCurrentStore(user);
    const sessions = await this.loadHistorySessions(
      user,
      currentStore.id,
      query.cursor,
      take,
    );
    const imageByMenuProductId = await this.loadMenuProductImages(sessions);

    // 会话级过滤必须发生在轮次合并之前：合并后丢失会话状态，就再也判定不了
    // 「订单是否已在 left 会话里结束」，制作中的订单会被错误混进历史。
    const filtered = sessions.map((session) => this.withHistoryOrders(session));
    const hasMore = filtered.length === take;
    const pageSessions = hasMore ? filtered.slice(0, -1) : filtered;
    const items = this.mergeSessionsByDiningRound(
      pageSessions.filter((session) => session.orders.length > 0),
    ).map((session) => this.toHistorySession(session, imageByMenuProductId));

    return {
      items,
      // 游标必须取自**原始降序序列里最后一个已消费会话**，不能用合并后的
      // items：合并会让元素携带更早（id 更大）的会话 id，导致下一页重复拉取
      // 已消费区间；整页都被过滤空时还会提前结束分页。
      nextCursor: hasMore ? (pageSessions.at(-1)?.id ?? null) : null,
    };
  }

  private loadHistorySessions(
    user: AuthenticatedUser,
    storeId: number,
    cursor: number | undefined,
    take: number,
  ): Promise<ClubOrderHistorySessionRow[]> {
    return this.prisma.scanOrderingSession.findMany({
      where: {
        clubUserId: user.id,
        storeId,
        // 历史记录必须包含清桌的 checked_out 会话，以及重新扫码时标记为
        // left（同时可能软删除）的会话；否则已支付订单会从两处列表都消失。
        status: {
          in: [
            ScanOrderingSessionStatus.checked_out,
            ScanOrderingSessionStatus.expired,
            ScanOrderingSessionStatus.left,
          ],
        },
        ...(cursor ? { id: { lt: cursor } } : {}),
      },
      orderBy: { id: 'desc' },
      take,
      select: CLUB_ORDER_HISTORY_SESSION_SELECT,
    });
  }

  /** left 会话裁掉仍在履约中的订单；其余状态原样返回。 */
  private withHistoryOrders(
    session: ClubOrderHistorySessionRow,
  ): ClubOrderHistorySessionRow {
    if (session.status !== ScanOrderingSessionStatus.left) {
      return session;
    }
    return {
      ...session,
      orders: session.orders.filter((order) =>
        LEFT_SESSION_HISTORY_ORDER_STATUS.has(order.status),
      ),
    };
  }

  /** 一次性取回本页涉及的菜单商品图片，供明细图片快照为空时兜底。 */
  private async loadMenuProductImages(
    sessions: ClubOrderHistorySessionRow[],
  ): Promise<Map<number, string | null>> {
    const menuProductIds = new Set<number>();
    for (const session of sessions) {
      for (const order of session.orders) {
        for (const item of order.items) {
          menuProductIds.add(item.menuProductId);
        }
      }
    }
    if (menuProductIds.size === 0) {
      return new Map();
    }

    const menuProducts = await this.prisma.scanOrderingMenuProduct.findMany({
      where: { id: { in: [...menuProductIds] } },
      select: {
        id: true,
        imageUrl: true,
        product: { select: { image: true } },
      },
    });
    return new Map(
      menuProducts.map((product) => [
        product.id,
        product.product?.image ?? product.imageUrl,
      ]),
    );
  }

  /**
   * 按 `diningRoundId` 合并同一轮用餐的多个会话。
   *
   * 用 Map 单趟索引（原实现 `reduce + findIndex + map` 是 O(n²)）；Map 保留
   * 首次插入顺序，等价于原实现「合并进最早出现的那一项、位置不变」的语义。
   * `guestCount` 取最大值，`orders` 合并后用同一个全序比较器重排。
   */
  private mergeSessionsByDiningRound(
    sessions: ClubOrderHistorySessionRow[],
  ): ClubOrderHistorySessionRow[] {
    const rounds = new Map<string, ClubOrderHistorySessionRow>();
    for (const session of sessions) {
      const existing = rounds.get(session.diningRoundId);
      if (!existing) {
        rounds.set(session.diningRoundId, session);
        continue;
      }
      rounds.set(session.diningRoundId, {
        ...existing,
        guestCount: Math.max(existing.guestCount, session.guestCount),
        orders: [...existing.orders, ...session.orders].sort(
          compareHistoryOrders,
        ),
      });
    }
    return [...rounds.values()];
  }

  private toHistorySession(
    session: ClubOrderHistorySessionRow,
    imageByMenuProductId: Map<number, string | null>,
  ): ClubOrderHistorySessionResponse {
    const { orders } = session;
    return {
      id: session.id,
      diningRoundId: session.diningRoundId,
      storeId: session.storeId,
      guestCount: session.guestCount,
      status: session.status,
      createdAt: session.createdAt.toISOString(),
      endedAt: session.endedAt?.toISOString() ?? null,
      archiveReason: session.archiveReason,
      table: session.table,
      orders: orders
        .slice(0, CLUB_ORDER_HISTORY_MAX_ORDERS_PER_SESSION)
        .map((order) => this.toHistoryOrder(order, imageByMenuProductId)),
      ordersTruncated:
        orders.length > CLUB_ORDER_HISTORY_MAX_ORDERS_PER_SESSION,
    };
  }

  private toHistoryOrder(
    order: ClubOrderHistoryOrderRow,
    imageByMenuProductId: Map<number, string | null>,
  ): ClubOrderHistoryOrderResponse {
    // marketingSnapshot 参与金额派生（pointsDeductAmount / discountItems），
    // 但不属于前端消费面：实测重会话里它约占响应 2/3，故只在响应里剔除。
    const {
      marketingSnapshot: _marketingSnapshot,
      items,
      ...orderColumns
    } = order;
    return {
      ...orderColumns,
      // 金额统一在后端换算为「元」，前端只负责展示。
      ...toOrderAmountSummary(order),
      pickupNumberLabel: this.pickupNumberService.formatPickupNumber(
        order.pickupNumber,
      ),
      pickupCalledAt: order.pickupCalledAt?.toISOString() ?? null,
      pickupCompletedAt: order.pickupCompletedAt?.toISOString() ?? null,
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
      items: items
        .slice(0, CLUB_ORDER_HISTORY_MAX_ITEMS_PER_ORDER)
        .map((item) => this.toHistoryItem(item, imageByMenuProductId)),
      itemsTruncated: items.length > CLUB_ORDER_HISTORY_MAX_ITEMS_PER_ORDER,
    };
  }

  private toHistoryItem(
    item: ClubOrderHistoryItemRow,
    imageByMenuProductId: Map<number, string | null>,
  ): ClubOrderHistoryItemResponse {
    // menuProductId 只服务于服务端图片兜底，前端类型未声明、运行时零读取。
    const { menuProductId, ...itemColumns } = item;
    return {
      ...itemColumns,
      unitPriceAmount: fenToYuan(item.unitPriceAmount),
      lineTotalAmount: fenToYuan(item.lineTotalAmount),
      payableLineAmount: fenToYuan(item.payableLineAmount),
      productImageUrlSnapshot:
        item.productImageUrlSnapshot ??
        imageByMenuProductId.get(menuProductId) ??
        null,
    };
  }
}
