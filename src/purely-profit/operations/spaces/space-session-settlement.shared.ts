import { SpaceBillingMode as PrismaSpaceBillingMode } from '@prisma/client';
import { centsToYuan } from '../../commerce/commerce.utils';
import { sumLineTotal } from './space-session-items.shared';
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
  const itemsCost = sumLineTotal(items);
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
  let timeCost = 0;

  if (
    session.billingMode !== PrismaSpaceBillingMode.items &&
    session.hourlyRate !== null
  ) {
    // session.hourlyRate 是 DB 中的分（Int），需转为元
    const hourlyRateYuan = centsToYuan(Number(session.hourlyRate));
    const useUnitPrice = timeFeeMode === 'unit_price';
    timeCost = useUnitPrice
      ? hourlyRateYuan
      : calcTimeCost(session.startTime.getTime(), checkoutAt, hourlyRateYuan);
    orderItems.unshift({
      productId: 'SYS_TIME_BILLING',
      productName: useUnitPrice
        ? '台位费（固定）'
        : `台位费（${durationLabel}）`,
      categoryName: '场地费',
      salePrice: timeCost,
      profit: timeCost,
      quantity: 1,
    });
  }

  // renewRecords.amount 已由 mapRenewRecordRows 转为元
  const renewDeduction = Number(
    renewRecords.reduce((sum, record) => sum + record.amount, 0).toFixed(2),
  );
  if (renewDeduction > 0) {
    orderItems.push({
      productId: 'SYS_RENEW_DEDUCTION',
      productName: '续费抵扣',
      categoryName: '场地费',
      salePrice: -renewDeduction,
      profit: -renewDeduction,
      quantity: 1,
    });
  }

  const prepaidDeduction = resolveSpaceSessionPrepaidDeduction(session);
  if (prepaidDeduction > 0) {
    orderItems.push({
      productId: 'SYS_PREPAID_DEDUCTION',
      productName: '预付抵扣',
      categoryName: '场地费',
      salePrice: -prepaidDeduction,
      profit: -prepaidDeduction,
      quantity: 1,
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
    });
  }

  const totalRevenue = sumLineTotal(orderItems);
  const totalProfit = sumLineProfit(orderItems);
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
    timeCost,
    itemsCost,
    renewDeduction,
    prepaidDeduction,
    totalAmount: totalRevenue,
    orderItems,
    totalRevenue,
    totalProfit,
    totalQuantity,
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

const resolveSpaceSessionPrepaidDeduction = (
  session: Pick<SpaceSessionRecord, 'billingMode' | 'prepaidAmount'>,
): number => {
  // 只要会话存在开台已收款，就应进入当前预计/结账/换房的扣减口径。
  // 纯 items 模式没有台位开台语义，继续保持不扣减以兼容旧数据。

  if (
    session.billingMode === PrismaSpaceBillingMode.items ||
    session.prepaidAmount === null
  ) {
    return 0;
  }

  // session.prepaidAmount 是 DB 中的分（Int），需转为元
  const prepaidAmountYuan = centsToYuan(Number(session.prepaidAmount));
  return prepaidAmountYuan > 0 ? prepaidAmountYuan : 0;
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

const calcTimeCost = (
  startTime: number,
  endTime: number,
  hourlyRate: number,
): number => {
  const minutes = calcDurationMinutes(startTime, endTime);
  return Math.ceil((minutes / 60) * hourlyRate * 100) / 100;
};

const sumLineProfit = (items: SpaceSessionItemRecord[]): number =>
  Number(
    items
      .reduce((sum, item) => sum + item.profit * item.quantity, 0)
      .toFixed(2),
  );
