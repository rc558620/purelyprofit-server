import { Prisma, SalesPaymentMethod } from '@prisma/client';
import { Money, calcRatioPercent } from '../../../shared/money.utils';
import type { HandoverPaymentItemDto } from './dto/handover-shared.dto';
import {
  PAYMENT_METHOD_CONFIG,
  SPACE_RENEW_DEDUCTION_ITEM_NAME,
  isPrepaidDeductionItem,
  type OrderItemRow,
  resolveOrderItemPaymentMethod,
  dbCentsToOutputYuan,
} from './handover.shared';
import type { HandoverRecordListItemDto } from './dto/handover-records.dto';

export const mapPaymentItems = (
  items: OrderItemRow[],
): HandoverPaymentItemDto[] => {
  const paymentAmountMap = new Map<SalesPaymentMethod, number>();

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

    const paymentMethod = resolveOrderItemPaymentMethod(item);
    paymentAmountMap.set(
      paymentMethod,
      Money.fromDbCents(paymentAmountMap.get(paymentMethod) ?? 0)
        .add(Money.fromDbCents(amountCents))
        .toDbCents(),
    );
  }

  return Array.from(paymentAmountMap.entries()).map(
    ([method, amountCents]) => ({
      method,
      label: PAYMENT_METHOD_CONFIG[method].label,
      amount: Money.fromDbCents(amountCents).toOutputYuan(),
      ratio: 0,
      color: PAYMENT_METHOD_CONFIG[method].color,
    }),
  );
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
 * 退款 = 预付款 > 实际消费时的差额（退给客人的金额）。
 * 直接基于 SpaceSession 数据计算，不依赖 SaleOrder.totalRevenue 符号。
 */
export const computeRefundAmountFromSessions = (
  sessions: Array<{
    timeCost: number | null;
    itemsCost: number;
    prepaidAmount: number | null;
  }>,
): number => {
  let totalRefundCents = 0;

  for (const session of sessions) {
    const prepaidCents = Number(session.prepaidAmount ?? 0);
    if (prepaidCents <= 0) continue;

    const consumptionCents = Money.fromDbCents(session.timeCost ?? 0)
      .add(Money.fromDbCents(session.itemsCost))
      .toDbCents();

    const refundCents = prepaidCents - consumptionCents;
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
