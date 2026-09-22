import type { HandoverOrderItemDto } from './dto/handover-shared.dto';
import {
  ORDER_ITEMS_LIMIT,
  mapRefundOrderItem,
  type OrderItemRow,
  type RefundOrderRow,
  type SettledSpaceSessionRow,
} from './handover.shared';
import type { SaleOrderRefundRow } from './handover.types';
import { mapScanOrderingRefundOrderItem } from './handover-order-item.mapper';
import { aggregateRegularOrderItems } from './handover-order-item-aggregator';
import { buildRenewSplitItems } from './handover-renew-items';
import {
  buildGuestPayableItems,
  buildRefundItemsFromSessions,
} from './handover-space-session-items';

export type { SettledSpaceSessionRow };

/** 交班明细排序：时间倒序 → 非退款行优先 → id 倒序 */
const sortDisplayedOrderItems = (
  items: HandoverOrderItemDto[],
): HandoverOrderItemDto[] =>
  items
    .sort((left, right) => {
      if (right.date !== left.date) {
        return right.date - left.date;
      }
      const leftIsRefund = left.id.startsWith('refund-');
      const rightIsRefund = right.id.startsWith('refund-');
      if (leftIsRefund !== rightIsRefund) {
        return rightIsRefund ? 1 : -1;
      }
      return right.id.localeCompare(left.id);
    })
    .slice(0, ORDER_ITEMS_LIMIT);

export const mergeDisplayedOrderItems = (
  orderItems: OrderItemRow[],
  refundOrders: RefundOrderRow[],
  settledSpaceSessions: SettledSpaceSessionRow[] = [],
  storeOwnerUserId: number | null = null,
  /** 当班操作员：扫码点餐订单（purelyClub 下单）无实际操作员时回退展示 */
  shiftOperatorName: string | null = null,
  /** 扫码点餐退款行（SaleOrderRefund）：映射为负数退款行与下单行并存 */
  scanOrderingRefunds: SaleOrderRefundRow[] = [],
): HandoverOrderItemDto[] => {
  const guestPayableItems = buildGuestPayableItems(
    settledSpaceSessions,
    storeOwnerUserId,
  );
  const refundItems = buildRefundItemsFromSessions(
    settledSpaceSessions,
    storeOwnerUserId,
  );
  // 已被退款的销售单 id 集合：退款单会同时返回下单+退款两行，下单行不展示库存
  const refundedOrderIds = new Set(
    scanOrderingRefunds.map((refund) => refund.saleOrder.id),
  );

  // 录入单子（手工补录单）订单：同一订单的多个商品行按商品+规格聚合，
  // 与普通商品行走同一聚合链路（aggregateRegularOrderItems），不合并为整单行。
  // 续费抵扣项按支付方式拆分：若同一会话使用了多种支付方式续费，
  // 拆为多行展示（如：微信 ¥100、支付宝 ¥50、刷卡 ¥70）。
  const mappedOrderItems: HandoverOrderItemDto[] = [];
  // 收集商品行，在循环结束后按订单+商品+规格聚合
  const regularItemsForAggregation: OrderItemRow[] = [];
  for (const item of orderItems) {
    // 手工补录单不再特殊处理，走常规聚合（按商品+规格叠加）
    const renewSplitItems = buildRenewSplitItems(item, storeOwnerUserId);
    if (renewSplitItems) {
      mappedOrderItems.push(...renewSplitItems);
      continue;
    }
    // 普通商品行：收集到数组，后续按订单+商品+规格聚合
    regularItemsForAggregation.push(item);
  }

  // 对普通商品行进行聚合（按订单 ID + 商品名称 + 规格叠加后映射）
  mappedOrderItems.push(
    ...aggregateRegularOrderItems(
      regularItemsForAggregation,
      storeOwnerUserId,
      shiftOperatorName,
      refundedOrderIds,
    ),
  );

  return sortDisplayedOrderItems([
    ...refundOrders.map((order) => mapRefundOrderItem(order)),
    ...scanOrderingRefunds.map((refund) =>
      mapScanOrderingRefundOrderItem(
        refund,
        storeOwnerUserId,
        shiftOperatorName,
      ),
    ),
    ...refundItems,
    ...mappedOrderItems,
    ...guestPayableItems,
  ]);
};
