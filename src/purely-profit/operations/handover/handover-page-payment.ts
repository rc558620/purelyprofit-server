import { Prisma, SalesPaymentMethod } from '@prisma/client';
import { Money, calcRatioPercent } from '../../../shared/money.utils';
import type { HandoverPaymentItemDto } from './dto/handover-shared.dto';
import {
  PAYMENT_METHOD_CONFIG,
  SPACE_RENEW_DEDUCTION_ITEM_NAME,
  isPrepaidDeductionItem,
  isSessionStartItem,
  type OrderItemRow,
  resolveOrderItemPaymentMethod,
  dbCentsToOutputYuan,
  GROUPON_VOUCHER_CUSTOMER_PAYMENT_METHOD,
  GROUPON_VOUCHER_DISPLAY,
} from './handover.shared';
import type { HandoverRecordListItemDto } from './dto/handover-records.dto';

type PaymentBucketKey = SalesPaymentMethod | 'groupon_voucher';

export const mapPaymentItems = (
  items: OrderItemRow[],
): HandoverPaymentItemDto[] => {
  const paymentAmountMap = new Map<PaymentBucketKey, number>();

  for (const item of items) {
    const rawAmountCents = Money.fromDbCents(item.salePrice)
      .multiply(item.quantity)
      .toDbCents();
    const amountCents =
      rawAmountCents > 0 ||
      isPrepaidDeductionItem(item.productName) ||
      item.productName === SPACE_RENEW_DEDUCTION_ITEM_NAME
        ? Math.abs(rawAmountCents)
        : 0;
    if (amountCents <= 0) {
      continue;
    }

    // 开台项（预付款 / 台位费）+ 团购顾客支付方式 → 归入团购桶，否则按门店结算方式归类
    const bucketKey: PaymentBucketKey =
      isSessionStartItem(item.productName) &&
      item.order.spaceSession?.prepaidCustomerPaymentMethod ===
        GROUPON_VOUCHER_CUSTOMER_PAYMENT_METHOD
        ? 'groupon_voucher'
        : resolveOrderItemPaymentMethod(item);

    paymentAmountMap.set(
      bucketKey,
      Money.fromDbCents(paymentAmountMap.get(bucketKey) ?? 0)
        .add(Money.fromDbCents(amountCents))
        .toDbCents(),
    );
  }

  return Array.from(paymentAmountMap.entries()).map(([method, amountCents]) => {
    const isGroupon = method === 'groupon_voucher';
    const config = isGroupon
      ? GROUPON_VOUCHER_DISPLAY
      : PAYMENT_METHOD_CONFIG[method as SalesPaymentMethod];
    return {
      method,
      label: config.label,
      amount: Money.fromDbCents(amountCents).toOutputYuan(),
      ratio: 0,
      color: config.color,
    };
  });
};

/**
 * 为每个收款项附加占比（ratio），消费统一封装的 calcRatioPercent。
 * ratio 语义：0-100 整数百分比，前端直接展示，无需任何转换。
 * totalYuan 应为收款金额合计（元），而非营业额。
 */
export const attachPaymentRatios = (
  items: HandoverPaymentItemDto[],
  totalYuan: number,
): HandoverPaymentItemDto[] =>
  items.map((item) => ({
    ...item,
    ratio: calcRatioPercent(item.amount, totalYuan, 0),
  }));

export const sumPaymentAmounts = (items: HandoverPaymentItemDto[]): number =>
  Money.sum(
    items.map((item) => Money.fromInputYuan(item.amount)),
  ).toOutputYuan();

/**
 * 从已结账的空间会话中计算退款金额。
 * 退款 = (prepaidAmount + renewTotal) > consumption 时的差额（退给客人的金额）。
 * 直接基于 SpaceSession 数据计算，不依赖 SaleOrder.totalRevenue 符号。
 *
 * ─── ⚠️ DO NOT 简化为仅 prepaidAmount ─────────────────────────────
 * 历史背景：BUG-1/5/7 修复前，续费会回写 session.prepaidAmount，
 * 导致"开台预付"和"续费"两个资金池混淆，产生重复抵扣。
 * 修复后 space-session-renew.service.ts 彻底移除了 prepaid* 回写，
 * 因此 prepaidAmount **仅包含开台预付款，不含续费金额**。
 * 退款必须从 sessionRenewRecords 独立累加续费，否则：
 *   - 无预付+续费场景：退款 = 0（续费溢出完全丢失）
 *   - 预付+续费混合：退款少算续费部分
 * 不要试图去掉 sessionRenewRecords 参数或改回 prepaidAmount > 0 守卫。
 */
export const computeRefundAmountFromSessions = (
  sessions: Array<{
    timeCost: number | null;
    itemsCost: number;
    prepaidAmount: number | null;
    sessionRenewRecords: { amount: number }[];
  }>,
): number => {
  let totalRefundCents = 0;

  for (const session of sessions) {
    const prepaidCents = Number(session.prepaidAmount ?? 0);
    // ─── ⚠️ DO NOT 去掉续费累加 ───────────────────────────────
    // prepaidAmount 仅含开台预付，不含续费（BUG-1/5/7 已移除续费回写）
    const renewTotalCents = session.sessionRenewRecords.reduce(
      (sum, r) => sum + Number(r.amount ?? 0),
      0,
    );
    const totalPaidCents = prepaidCents + renewTotalCents;
    if (totalPaidCents <= 0) continue;

    const consumptionCents = Money.fromDbCents(session.timeCost ?? 0)
      .add(Money.fromDbCents(session.itemsCost))
      .toDbCents();

    const refundCents = totalPaidCents - consumptionCents;
    if (refundCents > 0) {
      totalRefundCents += refundCents;
    }
  }

  return Money.fromDbCents(totalRefundCents).toOutputYuan();
};

export const buildRevenueAmounts = (
  spaceRevenue: Prisma.Decimal | number | null | undefined,
  additionalRevenue: Prisma.Decimal | number | null | undefined,
  refundAmount: number,
): {
  additionalRevenueAmount: number;
  spaceRevenueAmount: number;
  refundAmount: number;
} => ({
  additionalRevenueAmount: dbCentsToOutputYuan(additionalRevenue),
  spaceRevenueAmount: dbCentsToOutputYuan(spaceRevenue),
  refundAmount,
});

export const buildRecordRevenueSummary = (
  revenueAmounts: ReturnType<typeof buildRevenueAmounts>,
  orderCount: number,
  pettyCashAmount: number,
): NonNullable<HandoverRecordListItemDto['revenueSummary']> => {
  // 营业收入 = additionalRevenue（仅非空间订单，不含负数）
  // 空间管理 = spaceRevenue（空间会话消费金额）
  // 本班营业额 = 营业收入 + 空间管理
  return {
    additionalRevenue: revenueAmounts.additionalRevenueAmount,
    spaceRevenue: revenueAmounts.spaceRevenueAmount,
    refundAmount: revenueAmounts.refundAmount,
    totalRevenue: Money.fromInputYuan(revenueAmounts.additionalRevenueAmount)
      .add(Money.fromInputYuan(revenueAmounts.spaceRevenueAmount))
      .toOutputYuan(),
    orderCount,
    pettyCache: pettyCashAmount,
  };
};
