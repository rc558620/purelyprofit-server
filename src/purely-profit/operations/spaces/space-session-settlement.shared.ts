import { SpaceBillingMode as PrismaSpaceBillingMode } from '@prisma/client';
import { Money } from '../../../shared/money.utils';
import { sumLineTotalMoney, sumLineProfitMoney } from './space-session-items.shared';
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
  const { session, checkoutAt, payload, items, renewRecords } = params;
  // items 中的 salePrice/profit 已经由 mapSessionItemRows 转为元
  const orderItems = items.map((item) => ({ ...item }));
  const itemsCostMoney = sumLineTotalMoney(items);
  const durationMinutes = calcDurationMinutes(
    session.startTime.getTime(),
    checkoutAt,
  );
  const durationLabel = formatDurationLabel(durationMinutes);
  const resolvedFeeMode = resolveSpaceSessionFeeMode(
    session,
    renewRecords,
    payload,
  );
  const timeFeeMode = resolvedFeeMode.timeFeeMode;
  const countdownFeeMode = resolvedFeeMode.countdownFeeMode;
  let timeCostMoney = Money.zero();

  if (
    session.billingMode !== PrismaSpaceBillingMode.items &&
    session.hourlyRate !== null
  ) {
    const hourlyRateMoney = Money.fromDbCents(session.hourlyRate);
    const useUnitPrice = timeFeeMode === 'unit_price';
    timeCostMoney = useUnitPrice
      ? hourlyRateMoney
      : calcTimeCostMoney(session.startTime.getTime(), checkoutAt, hourlyRateMoney);
    const timeCostYuan = timeCostMoney.toOutputYuan();
    orderItems.unshift({
      productId: 'SYS_TIME_BILLING',
      productName: useUnitPrice
        ? '台位费（固定）'
        : `台位费（${durationLabel}）`,
      categoryName: '场地费',
      salePrice: timeCostYuan,
      profit: timeCostYuan,
      quantity: 1,
      lineTotal: timeCostYuan,
    });
  }

  // renewRecords.amount 已由 mapRenewRecordRows 转为元
  const renewDeductionMoney = renewRecords.reduce(
    (sum, record) => sum.add(Money.fromInputYuan(record.amount)),
    Money.zero(),
  );
  const renewDeductionYuan = renewDeductionMoney.toOutputYuan();
  if (renewDeductionMoney.isPositive()) {
    orderItems.push({
      productId: 'SYS_RENEW_DEDUCTION',
      productName: '续费抵扣',
      categoryName: '场地费',
      salePrice: -renewDeductionYuan,
      profit: -renewDeductionYuan,
      quantity: 1,
      lineTotal: -renewDeductionYuan,
    });
  }

  const prepaidDeductionMoney = resolveSpaceSessionPrepaidDeductionMoney(session);
  const prepaidDeductionYuan = prepaidDeductionMoney.toOutputYuan();
  if (prepaidDeductionMoney.isPositive()) {
    orderItems.push({
      productId: 'SYS_PREPAID_DEDUCTION',
      productName: '预付款',
      categoryName: '场地费',
      salePrice: -prepaidDeductionYuan,
      profit: -prepaidDeductionYuan,
      quantity: 1,
      lineTotal: -prepaidDeductionYuan,
    });
  }

  if (orderItems.length === 0) {
    orderItems.push({
      productId: 'SYS_EMPTY_SETTLEMENT',
      productName: '场地结账',
      categoryName: '场地费',
      salePrice: 0,
      profit: 0,
      quantity: 1,
      lineTotal: 0,
    });
  }

  const totalRevenueMoney = sumLineTotalMoney(orderItems);
  const totalProfitMoney = sumLineProfitMoney(orderItems);
  const totalQuantity = orderItems.reduce(
    (sum, item) =>
      sum + (isSpaceSessionDeductionItem(item.productId) ? 0 : item.quantity),
    0,
  );

  return {
    durationMinutes,
    durationLabel,
    ...(timeFeeMode ? { timeFeeMode } : {}),
    ...(countdownFeeMode ? { countdownFeeMode } : {}),
    timeCost: timeCostMoney.toOutputYuan(),
    itemsCost: itemsCostMoney.toOutputYuan(),
    renewDeduction: renewDeductionYuan,
    prepaidDeduction: prepaidDeductionYuan,
    totalAmount: totalRevenueMoney.toOutputYuan(),
    orderItems,
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
  const { session, checkoutAt, payload, items, renewRecords } = params;
  const orderItems = items.map((item) => ({ ...item }));
  const itemsCostMoney = sumLineTotalMoney(items);
  const durationMinutes = calcDurationMinutes(
    session.startTime.getTime(),
    checkoutAt,
  );
  const durationLabel = formatDurationLabel(durationMinutes);
  const resolvedFeeMode = resolveSpaceSessionFeeMode(
    session,
    renewRecords,
    payload,
  );
  const timeFeeMode = resolvedFeeMode.timeFeeMode;
  const countdownFeeMode = resolvedFeeMode.countdownFeeMode;
  let timeCostMoney = Money.zero();

  if (
    session.billingMode !== PrismaSpaceBillingMode.items &&
    session.hourlyRate !== null
  ) {
    const hourlyRateMoney = Money.fromDbCents(session.hourlyRate);
    const useUnitPrice = timeFeeMode === 'unit_price';
    timeCostMoney = useUnitPrice
      ? hourlyRateMoney
      : calcTimeCostMoney(session.startTime.getTime(), checkoutAt, hourlyRateMoney);
    const timeCostYuan = timeCostMoney.toOutputYuan();
    orderItems.unshift({
      productId: 'SYS_TIME_BILLING',
      productName: useUnitPrice
        ? '台位费（固定）'
        : `台位费（${durationLabel}）`,
      categoryName: '场地费',
      salePrice: timeCostYuan,
      profit: timeCostYuan,
      quantity: 1,
      lineTotal: timeCostYuan,
    });
  }

  const renewDeductionMoney = renewRecords.reduce(
    (sum, record) => sum.add(Money.fromInputYuan(record.amount)),
    Money.zero(),
  );
  if (renewDeductionMoney.isPositive()) {
    const renewDeductionYuan = renewDeductionMoney.toOutputYuan();
    orderItems.push({
      productId: 'SYS_RENEW_DEDUCTION',
      productName: '续费抵扣',
      categoryName: '场地费',
      salePrice: -renewDeductionYuan,
      profit: -renewDeductionYuan,
      quantity: 1,
      lineTotal: -renewDeductionYuan,
    });
  }

  const prepaidDeductionMoney = resolveSpaceSessionPrepaidDeductionMoney(session);
  if (prepaidDeductionMoney.isPositive()) {
    const prepaidDeductionYuan = prepaidDeductionMoney.toOutputYuan();
    orderItems.push({
      productId: 'SYS_PREPAID_DEDUCTION',
      productName: '预付款',
      categoryName: '场地费',
      salePrice: -prepaidDeductionYuan,
      profit: -prepaidDeductionYuan,
      quantity: 1,
      lineTotal: -prepaidDeductionYuan,
    });
  }

  if (orderItems.length === 0) {
    orderItems.push({
      productId: 'SYS_EMPTY_SETTLEMENT',
      productName: '场地结账',
      categoryName: '场地费',
      salePrice: 0,
      profit: 0,
      quantity: 1,
      lineTotal: 0,
    });
  }

  const totalRevenueMoney = sumLineTotalMoney(orderItems);
  const totalProfitMoney = sumLineProfitMoney(orderItems);

  return {
    durationMinutes,
    durationLabel,
    timeFeeMode,
    countdownFeeMode,
    timeCostMoney,
    itemsCostMoney,
    renewDeductionMoney,
    prepaidDeductionMoney,
    totalAmountMoney: totalRevenueMoney,
    totalRevenueMoney,
    totalProfitMoney,
    orderItems,
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

const resolveSpaceSessionPrepaidDeductionMoney = (
  session: Pick<SpaceSessionRecord, 'prepaidAmount'>,
): Money => {
  if (session.prepaidAmount === null) {
    return Money.zero();
  }

  const prepaidMoney = Money.fromDbCents(session.prepaidAmount);
  return prepaidMoney.isPositive() ? prepaidMoney : Money.zero();
};

const isSpaceSessionDeductionItem = (productId: string): boolean =>
  productId === 'SYS_RENEW_DEDUCTION' || productId === 'SYS_PREPAID_DEDUCTION';

const calcDurationMinutes = (startTime: number, endTime: number): number => {
  const rawMinutes = (endTime - startTime) / (1000 * 60);
  return Math.max(1, Math.ceil(rawMinutes));
};

const formatDurationLabel = (durationMinutes: number): string => {
  const hours = Math.floor(durationMinutes / 60);
  const minutes = durationMinutes % 60;
  return hours > 0
    ? `${hours}小时${minutes > 0 ? `${minutes}分钟` : ''}`
    : `${minutes}分钟`;
};

/**
 * 计时费用计算（全程 Money 运算，金额向上取整到分）。
 * 规则：不足 1 分钟按 1 分钟计，分钟数向上取整，
 *       金额 = (分钟数 / 60) × 时薪，向上取整到分。
 */
const calcTimeCostMoney = (
  startTime: number,
  endTime: number,
  hourlyRateMoney: Money,
): Money => {
  const minutes = calcDurationMinutes(startTime, endTime);
  // minutes / 60 是乘数（如 90分钟 = 1.5 小时）
  // 用 multiplyCeilToCent 保证结果向上取整到分
  return hourlyRateMoney.multiplyCeilToCent(minutes / 60);
};
