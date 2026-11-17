// 扫码点餐退款行映射：SaleOrderRefund → 交班明细的退款展示行
import { SalesPaymentMethod } from '@prisma/client';
import {
  AUTO_SETTLEMENT_OPERATOR_NAME,
  CASHIER_PREFIX,
  DINE_IN_PREFIX,
  TAKEOUT_PREFIX,
  PAYMENT_METHOD_CONFIG,
  SPACE_REFUND_DISPLAY_SUFFIX,
  resolveManualEntrySourceLabel,
} from './handover.constants';
import type { SaleOrderRefundRow } from './handover.types';
import type { HandoverOrderItemDto } from './dto/handover-shared.dto';
import {
  dbCentsToOutputYuan,
  resolveOperatorRole,
  toDisplayName,
} from './handover.utils';

/**
 * 映射扫码点餐退款行（SaleOrderRefund → 退款展示行）：
 * 金额为负数，支付标签展示「退回微信 / 退回余额」等，
 * 与下单订单行同时展示保证账目平衡。
 */
export const mapScanOrderingRefundOrderItem = (
  refund: SaleOrderRefundRow,
  storeOwnerUserId: number | null = null,
  shiftOperatorName: string | null = null,
): HandoverOrderItemDto => {
  const tableCode = toDisplayName(refund.saleOrder.scanOrder?.table?.tableCode);
  // 展示原下单商品名（取订单第一条商品），替代固定“退款”文案
  const productName = toDisplayName(refund.saleOrder.items[0]?.productName);
  const displayName = productName ?? SPACE_REFUND_DISPLAY_SUFFIX;
  // 退回渠道标签：余额（other）显示退回纯利宝，其余渠道显示「退回 + 支付方式标签」
  // 手工补录单仅「平台结算」时展示来源渠道（如退回美团团购/退回美团外卖），
  // 其他支付方式（刷卡/微信等）退回时展示实际收款方式，避免来源渠道覆盖支付方式。
  const paymentLabel = refund.saleOrder.manualEntry
    ? (() => {
        const sourceLabel =
          refund.paymentMethod === SalesPaymentMethod.platform
            ? resolveManualEntrySourceLabel(refund.saleOrder.sourceChannel)
            : '';
        return sourceLabel
          ? `退回${sourceLabel}`
          : `退回${PAYMENT_METHOD_CONFIG[refund.paymentMethod].label}`;
      })()
    : refund.paymentMethod === SalesPaymentMethod.other
      ? '退回纯利宝'
      : `退回${PAYMENT_METHOD_CONFIG[refund.paymentMethod].label}`;
  const timestamp = refund.refundedAt.getTime();
  // 退款行展示退款后恢复的库存：取原订单第一条商品（与下单行商品名同源）
  const refundItem = refund.saleOrder.items[0];

  return {
    id: `scan-refund-${refund.id}`,
    productName: refund.saleOrder.manualEntry
      ? `${refund.saleOrder.diningMode === 'takeaway' || refund.saleOrder.diningMode === 'platform' ? TAKEOUT_PREFIX : DINE_IN_PREFIX} · ${displayName}`
      : tableCode
        ? `${tableCode} · ${displayName}`
        : `${CASHIER_PREFIX} · ${displayName}`,
    quantity: 1,
    // 退款金额以负数展示：下单 + 退款两行并存时账目可平
    totalRevenue: -dbCentsToOutputYuan(refund.amount),
    paymentLabel,
    paymentColor: PAYMENT_METHOD_CONFIG[refund.paymentMethod].color,
    operatorName:
      toDisplayName(refund.saleOrder.operatorNameSnapshot) ??
      toDisplayName(refund.saleOrder.operatorStaff?.name) ??
      toDisplayName(shiftOperatorName) ??
      AUTO_SETTLEMENT_OPERATOR_NAME,
    operatorRole: resolveOperatorRole(
      refund.saleOrder.operatorStaff,
      storeOwnerUserId,
    ),
    date: timestamp,
    displayDate: timestamp,
    currentStock: refundItem?.product?.stock ?? null,
    stockUnit: refundItem?.product?.unit ?? null,
    // 退款行不展示开台/续费/结账标签
    timeCategory: null,
    grouponCode: null,
    hasDiscount: false,
  };
};
