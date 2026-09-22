import { SalesPaymentMethod } from '@prisma/client';
import { Money } from '../../../shared/money.utils';
import type { HandoverOrderItemDto } from './dto/handover-shared.dto';
import type { SettledSpaceSessionRow } from './handover.types';
import {
  PAYMENT_METHOD_CONFIG,
  SPACE_GUEST_PAYABLE_COLOR,
  SPACE_GUEST_PAYABLE_ITEM_NAME,
  SPACE_REFUND_ITEM_NAME,
  SPACE_REFUND_DISPLAY_SUFFIX,
  GROUPON_VOUCHER_CUSTOMER_PAYMENT_METHOD,
  buildGrouponLabel,
  toDisplayName,
  resolveOperatorRole,
} from './handover.shared';

const AUTO_SETTLEMENT_OPERATOR_NAME = '空间自动结账';

/**
 * 已付总额（分）= 开台预付 + 续费累加。
 *
 * ─── ⚠️ DO NOT 简化为仅 prepaidAmount ─────────────────────────────
 * prepaidAmount 仅含开台预付款，不含续费（BUG-1/5/7 已移除续费回写 prepaid*）。
 * 如果去掉续费累加：
 *   - 无预付+续费场景：totalPaidCents = 0 → 客人应付 = 全部消费（多收客户钱）
 *   - 预付+续费混合：客人应付只扣预付部分（多收） / 退款少算（资金损失）
 */
const resolveTotalPaidCents = (session: SettledSpaceSessionRow): number => {
  const prepaidCents = Number(session.prepaidAmount ?? 0);
  const renewTotalCents = session.sessionRenewRecords.reduce(
    (sum, r) => sum + Number(r.amount ?? 0),
    0,
  );
  return prepaidCents + renewTotalCents;
};

/** 会话实际消费（分）= 时长费用 + 商品费用 */
const resolveConsumptionCents = (session: SettledSpaceSessionRow): number =>
  Money.fromDbCents(session.timeCost ?? 0)
    .add(Money.fromDbCents(session.itemsCost))
    .toDbCents();

/** 结账操作员展示名：快照 → 关联员工 → 自动结账兜底 */
const resolveSettlementOperatorName = (
  session: SettledSpaceSessionRow,
): string =>
  toDisplayName(session.saleOrder?.operatorNameSnapshot) ??
  toDisplayName(session.saleOrder?.operatorStaff?.name) ??
  AUTO_SETTLEMENT_OPERATOR_NAME;

export const buildGuestPayableItems = (
  settledSessions: SettledSpaceSessionRow[],
  storeOwnerUserId: number | null = null,
): HandoverOrderItemDto[] => {
  const items: HandoverOrderItemDto[] = [];

  for (const session of settledSessions) {
    const consumptionCents = resolveConsumptionCents(session);
    const totalPaidCents = resolveTotalPaidCents(session);
    // 总已付 < 消费：退款场景（由 buildRefundItemsFromSessions 处理），跳过
    // 总已付 === 消费：生成 ¥0.00 客人应付项，记录结账操作员/时间/支付方式
    // 总已付 > 消费：正常客人应付
    if (consumptionCents < totalPaidCents) continue;

    const payableAmountCents = Money.fromDbCents(consumptionCents)
      .subtract(Money.fromDbCents(totalPaidCents))
      .toDbCents();
    if (payableAmountCents < 0) continue;

    // BUG fix: 当顾客支付方式为团购券时，使用团购标签而非门店侧结算方式（如现金）
    const isGrouponCustomerPayment =
      session.prepaidCustomerPaymentMethod ===
      GROUPON_VOUCHER_CUSTOMER_PAYMENT_METHOD;
    const paymentLabel = isGrouponCustomerPayment
      ? buildGrouponLabel(session.prepaidGrouponPlatform)
      : PAYMENT_METHOD_CONFIG[
          session.saleOrder?.paymentMethod ?? SalesPaymentMethod.wechat
        ].label;
    const date = session.endTime?.getTime() ?? Date.now();
    const spaceName = session.space?.name ?? '';

    items.push({
      id: `guest-payable-${session.id}`,
      productName: `${spaceName} · ${SPACE_GUEST_PAYABLE_ITEM_NAME}`,
      quantity: 1,
      totalRevenue: Money.fromDbCents(payableAmountCents).toOutputYuan(),
      paymentLabel,
      paymentColor: SPACE_GUEST_PAYABLE_COLOR,
      operatorName: resolveSettlementOperatorName(session),
      operatorRole: resolveOperatorRole(
        session.saleOrder?.operatorStaff ?? null,
        storeOwnerUserId,
      ),
      date,
      displayDate: date,
      currentStock: null,
      stockUnit: null,
      timeCategory: 'session_end',
      grouponCode: session.prepaidGrouponCode ?? null,
      hasDiscount: false,
    });
  }

  return items;
};

/**
 * 从已结账的空间会话中构建退款展示项。
 * 退款条件：(prepaidAmount + renewTotal) > (timeCost + itemsCost)，
 * 即已付总额（开台预付 + 续费）超过实际消费。
 * 退款金额 = -(totalPaid - consumption)，以负数表示退款。
 * 支付标签格式："微信退款" / "支付宝退款"（与历史退款订单一致）。
 *
 * ─── ⚠️ DO NOT 改回 prepaidAmount > 0 守卫 ──────────────────────
 * prepaidAmount 仅含开台预付，不含续费（BUG-1/5/7 已移除续费回写 prepaid*）。
 * 原逻辑 `if (prepaidCents <= 0) continue` 在无预付+有续费场景下
 * 会直接跳过，导致续费溢出金额完全无法退款。
 */
export const buildRefundItemsFromSessions = (
  settledSessions: SettledSpaceSessionRow[],
  storeOwnerUserId: number | null = null,
): HandoverOrderItemDto[] => {
  const items: HandoverOrderItemDto[] = [];

  for (const session of settledSessions) {
    const totalPaidCents = resolveTotalPaidCents(session);
    if (totalPaidCents <= 0) continue;

    const consumptionCents = resolveConsumptionCents(session);
    if (totalPaidCents <= consumptionCents) continue;

    const refundCents = totalPaidCents - consumptionCents;
    // 退款支付方式优先取 saleOrder（结账方式），回退到最新续费记录的支付方式
    const latestRenewMethod =
      session.sessionRenewRecords.length > 0
        ? session.sessionRenewRecords[session.sessionRenewRecords.length - 1]
            .paymentMethod
        : undefined;
    const paymentMethod =
      session.saleOrder?.paymentMethod ??
      (latestRenewMethod as SalesPaymentMethod) ??
      SalesPaymentMethod.wechat;
    const date = session.endTime?.getTime() ?? Date.now();
    // 退款行商品名追加 " · 退款"，无空间名时回退到「空间退款」
    const refundProductName = session.space?.name
      ? `${session.space.name} · ${SPACE_REFUND_DISPLAY_SUFFIX}`
      : SPACE_REFUND_ITEM_NAME;

    items.push({
      id: `refund-session-${session.id}`,
      productName: refundProductName,
      quantity: 1,
      totalRevenue: -Money.fromDbCents(refundCents).toOutputYuan(),
      paymentLabel: `${PAYMENT_METHOD_CONFIG[paymentMethod].label}退款`,
      paymentColor: PAYMENT_METHOD_CONFIG[paymentMethod].color,
      operatorName: resolveSettlementOperatorName(session),
      operatorRole: resolveOperatorRole(
        session.saleOrder?.operatorStaff ?? null,
        storeOwnerUserId,
      ),
      date,
      displayDate: date,
      currentStock: null,
      stockUnit: null,
      timeCategory: 'session_end',
      grouponCode: session.prepaidGrouponCode ?? null,
      hasDiscount: false,
    });
  }

  return items;
};
