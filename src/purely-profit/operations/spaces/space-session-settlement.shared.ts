import { SpaceBillingMode as PrismaSpaceBillingMode } from '@prisma/client';
import { Money } from '../../../shared/money.utils';
import {
  sumLineTotalMoney,
  sumLineProfitMoney,
} from './space-session-items.shared';
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
  const resolvedFeeMode = resolveSpaceSessionFeeMode(
    session,
    renewRecords,
    payload,
  );
  const { timeFeeMode, countdownFeeMode } = resolvedFeeMode;
  let timeCostMoney = Money.zero();

  if (
    session.billingMode !== PrismaSpaceBillingMode.items &&
    session.hourlyRate !== null
  ) {
    const hourlyRateMoney = Money.fromDbCents(session.hourlyRate);
    const useUnitPrice = timeFeeMode === 'unit_price';
    timeCostMoney = useUnitPrice
      ? hourlyRateMoney
      : calcTimeCostMoney(
          session.startTime.getTime(),
          checkoutAt,
          hourlyRateMoney,
        );
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

  // Bug 4 fix: 续费抵扣取 amount 与 voucherFaceAmount 的较大值
  // 与 renew.service 中 addedMinutes 计算口径一致（"花 80 享 100"按 100 元抵扣）
  const renewDeductionMoney = renewRecords.reduce((sum, record) => {
    const amountMoney = Money.fromInputYuan(record.amount);
    const effectiveMoney =
      record.voucherFaceAmount !== undefined
        ? Money.max(amountMoney, Money.fromInputYuan(record.voucherFaceAmount))
        : amountMoney;
    return sum.add(effectiveMoney);
  }, Money.zero());
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

  const prepaidDeductionMoney =
    resolveSpaceSessionPrepaidDeductionMoney(session);
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

  return {
    orderItems,
    itemsCostMoney,
    durationMinutes,
    durationLabel,
    timeFeeMode,
    countdownFeeMode,
    timeCostMoney,
    renewDeductionMoney,
    prepaidDeductionMoney,
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
 * G1/G2 fix: 预付抵扣取 prepaidAmount 与 prepaidVoucherFaceAmount 的较大值。
 * 与续费链路 renewDeduction 的 max(amount, voucherFaceAmount) 口径一致。
 * 场景：开台预付团购"花 80 享 100"→ 按 100 元抵扣；
 *       结账时团购券面金额同样纳入抵扣，避免"已计费但无人支付"的缺口。
 */
const resolveSpaceSessionPrepaidDeductionMoney = (
  session: Pick<
    SpaceSessionRecord,
    'prepaidAmount' | 'prepaidVoucherFaceAmount'
  >,
): Money => {
  const prepaidMoney =
    session.prepaidAmount !== null
      ? Money.fromDbCents(session.prepaidAmount)
      : Money.zero();
  const voucherMoney =
    session.prepaidVoucherFaceAmount !== null
      ? Money.fromDbCents(session.prepaidVoucherFaceAmount)
      : Money.zero();
  const effective = Money.max(prepaidMoney, voucherMoney);
  return effective.isPositive() ? effective : Money.zero();
};

const isSpaceSessionDeductionItem = (productId: string): boolean =>
  productId === 'SYS_RENEW_DEDUCTION' || productId === 'SYS_PREPAID_DEDUCTION';

/**
 * B5 fix: 判断是否为不计入销售件数的系统虚拟行。
 * 包含抵扣项（负值行）和台位费/空结算等系统占位行，
 * 避免 totalQuantity 虚高污染销量统计。
 */
const isNonQuantitySystemItem = (productId: string): boolean =>
  isSpaceSessionDeductionItem(productId) ||
  productId === 'SYS_TIME_BILLING' ||
  productId === 'SYS_EMPTY_SETTLEMENT';

/**
 * BUG-7 fix: 导出基于 productId 的抵扣项判定函数，
 * 供 settlement.service 及下游统一使用，避免 productName 文案变更后判定静默失效。
 */
export const isSpaceSessionDeductionProductId = isSpaceSessionDeductionItem;

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
