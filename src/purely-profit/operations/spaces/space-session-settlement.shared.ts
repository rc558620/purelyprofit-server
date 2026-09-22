import { SpaceBillingMode as PrismaSpaceBillingMode } from '@prisma/client';
import { Money } from '../../../shared/money.utils';
import {
  sumLineTotalMoney,
  sumLineProfitMoney,
} from './space-session-items.shared';
import {
  buildSelfOrderDeductionOrderItems,
  resolvePrepaidDeductionOrderItem,
  resolveRenewDeductionOrderItem,
  resolveSpaceTimeBillingOrderItem,
} from './space-session-settlement-lines.shared';
import {
  calcDurationMinutes,
  formatDurationLabel,
} from './space-session-settlement-time.shared';
import {
  buildEmptySettlementOrderItem,
  isNonQuantitySystemItem,
  sumSelfOrderDeductionMoney,
} from './space-session-settlement-system-item.shared';
import type {
  CheckoutPreviewFeeMode,
  SpaceSessionItemRecord,
  SpaceSessionRecord,
  SpaceSessionRenewRecord,
  SpaceSessionSettlement,
  SpaceSessionSettlementRecord,
} from './space-sessions.types';

export const buildSpaceSessionSettlement = (params: {
  session: SpaceSessionSettlementRecord;
  checkoutAt: number;
  payload: CheckoutPreviewFeeMode;
  items: SpaceSessionItemRecord[];
  renewRecords: SpaceSessionRenewRecord[];
}): SpaceSessionSettlement => {
  const core = buildSpaceSessionSettlementCore(params);
  const totalRevenueMoney = sumLineTotalMoney(core.orderItems);
  const totalProfitMoney = sumLineProfitMoney(core.orderItems);
  const totalQuantity = core.orderItems.reduce(
    (sum, item) =>
      sum + (isNonQuantitySystemItem(item.productId) ? 0 : item.quantity),
    0,
  );
  return {
    durationMinutes: core.durationMinutes,
    durationLabel: core.durationLabel,
    ...(core.timeFeeMode ? { timeFeeMode: core.timeFeeMode } : {}),
    ...(core.countdownFeeMode
      ? { countdownFeeMode: core.countdownFeeMode }
      : {}),
    timeCost: core.timeCostMoney.toOutputYuan(),
    itemsCost: core.itemsCostMoney.toOutputYuan(),
    renewDeduction: core.renewDeductionMoney.toOutputYuan(),
    prepaidDeduction: core.prepaidDeductionMoney.toOutputYuan(),
    selfOrderDeduction: core.selfOrderDeductionMoney.toOutputYuan(),
    totalAmount: totalRevenueMoney.toOutputYuan(),
    orderItems: core.orderItems,
    totalRevenue: totalRevenueMoney.toOutputYuan(),
    totalProfit: totalProfitMoney.toOutputYuan(),
    totalQuantity,
  };
};

/**
 * 构建结账金额的 Money 版本，供 live-preview / renew-preview 等只读预览接口使用。
 * 返回的金额字段全部是 Money 对象，调用方自行决定何时 toOutputYuan()。
 */
export const buildSpaceSessionSettlementMoney = (params: {
  session: SpaceSessionSettlementRecord;
  checkoutAt: number;
  payload: CheckoutPreviewFeeMode;
  items: SpaceSessionItemRecord[];
  renewRecords: SpaceSessionRenewRecord[];
}) => {
  const core = buildSpaceSessionSettlementCore(params);
  const totalRevenueMoney = sumLineTotalMoney(core.orderItems);
  const totalProfitMoney = sumLineProfitMoney(core.orderItems);
  return {
    durationMinutes: core.durationMinutes,
    durationLabel: core.durationLabel,
    timeFeeMode: core.timeFeeMode,
    countdownFeeMode: core.countdownFeeMode,
    timeCostMoney: core.timeCostMoney,
    itemsCostMoney: core.itemsCostMoney,
    renewDeductionMoney: core.renewDeductionMoney,
    prepaidDeductionMoney: core.prepaidDeductionMoney,
    selfOrderDeductionMoney: core.selfOrderDeductionMoney,
    totalAmountMoney: totalRevenueMoney,
    totalRevenueMoney,
    totalProfitMoney,
    orderItems: core.orderItems,
  };
};

/**
 * 结账结算核心：构建 orderItems 并计算所有金额中间值。
 * 供 buildSpaceSessionSettlement / buildSpaceSessionSettlementMoney 共享调用。
 */
const buildSpaceSessionSettlementCore = (params: {
  session: SpaceSessionSettlementRecord;
  checkoutAt: number;
  payload: CheckoutPreviewFeeMode;
  items: SpaceSessionItemRecord[];
  renewRecords: SpaceSessionRenewRecord[];
}) => {
  const { session, checkoutAt, payload, items, renewRecords } = params;
  // items 中的 salePrice/profit 已经由 mapSessionItemRows 转为元
  const orderItems = items.map((item) => ({ ...item }));
  const itemsCostMoney = sumLineTotalMoney(items);
  const durationMinutes = calcDurationMinutes(
    session.startTime.getTime(),
    checkoutAt,
  );
  const durationLabel = formatDurationLabel(durationMinutes);
  const { timeFeeMode, countdownFeeMode } = resolveSpaceSessionFeeMode(
    session,
    renewRecords,
    payload,
  );

  const timeBilling = resolveSpaceTimeBillingOrderItem({
    session,
    checkoutAt,
    timeFeeMode,
    durationLabel,
  });
  if (timeBilling) {
    orderItems.unshift(timeBilling.orderItem);
  }

  const { renewDeductionMoney, orderItem: renewDeductionItem } =
    resolveRenewDeductionOrderItem(renewRecords);
  if (renewDeductionItem) {
    orderItems.push(renewDeductionItem);
  }

  const { prepaidDeductionMoney, orderItem: prepaidDeductionItem } =
    resolvePrepaidDeductionOrderItem(session);
  if (prepaidDeductionItem) {
    orderItems.push(prepaidDeductionItem);
  }

  const selfOrderDeductionMoney = sumSelfOrderDeductionMoney(items);
  orderItems.push(...buildSelfOrderDeductionOrderItems(items));

  if (orderItems.length === 0) {
    orderItems.push(buildEmptySettlementOrderItem());
  }

  return {
    orderItems,
    itemsCostMoney,
    durationMinutes,
    durationLabel,
    timeFeeMode,
    countdownFeeMode,
    timeCostMoney: timeBilling?.timeCostMoney ?? Money.zero(),
    renewDeductionMoney,
    prepaidDeductionMoney,
    selfOrderDeductionMoney,
  };
};

export const resolveCheckoutPreviewFeeMode = (
  billingMode: PrismaSpaceBillingMode,
  payload: CheckoutPreviewFeeMode,
  renewRecords: SpaceSessionRenewRecord[],
): CheckoutPreviewFeeMode => {
  if (billingMode === PrismaSpaceBillingMode.items) {
    return {};
  }

  return resolveSpaceSessionFeeMode({ billingMode }, renewRecords, payload);
};

const resolveSpaceSessionFeeMode = (
  session: Pick<SpaceSessionRecord, 'billingMode'>,
  renewRecords: SpaceSessionRenewRecord[],
  payload: CheckoutPreviewFeeMode,
): Required<CheckoutPreviewFeeMode> => {
  if (session.billingMode === PrismaSpaceBillingMode.items) {
    return {
      timeFeeMode: 'timed',
      countdownFeeMode: 'timed',
    };
  }

  if (session.billingMode === PrismaSpaceBillingMode.countdown) {
    const countdownFeeMode =
      payload.countdownFeeMode ??
      (payload.timeFeeMode === 'unit_price'
        ? 'fixed'
        : payload.timeFeeMode === 'timed'
          ? 'timed'
          : renewRecords.length > 0
            ? 'timed'
            : 'fixed');

    return {
      timeFeeMode: countdownFeeMode === 'fixed' ? 'unit_price' : 'timed',
      countdownFeeMode,
    };
  }

  return {
    timeFeeMode: payload.timeFeeMode ?? 'timed',
    countdownFeeMode: payload.countdownFeeMode ?? 'timed',
  };
};

/**
 * Bug 1 & 8 fix + R2 fix + B4 fix: 从续费记录中提取最新的团购元数据，
 * 作为结算时团购字段的回退默认值（checkout payload / session.prepaid* 优先）。
 *
 * B4 fix: 不再返回 customerPaymentMethod / settlementChannel，
 * 避免在混合支付场景下篡改真实尾款支付方式。
 * 支付方式应来自 session.prepaid* 或 checkout payload 的显式值。
 */
export const resolveRenewRecordsGrouponFallback = (
  renewRecords: SpaceSessionRenewRecord[],
): {
  grouponCode?: string;
  grouponPlatform?: string;
  voucherFaceAmount?: number;
} => {
  // 从后往前找最后一条有团购信息的续费记录
  for (let i = renewRecords.length - 1; i >= 0; i--) {
    const record = renewRecords[i];
    if (record.grouponCode && record.grouponPlatform) {
      return {
        grouponCode: record.grouponCode,
        grouponPlatform: record.grouponPlatform,
        ...(record.voucherFaceAmount !== undefined
          ? { voucherFaceAmount: record.voucherFaceAmount }
          : {}),
      };
    }
  }
  return {};
};
