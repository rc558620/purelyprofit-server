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
import type { SettleSpaceSessionParams } from './space-session-settlement.types';

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

/** 结算入参中的团购/券元数据片段（供 settleSession 展开） */
export type SettlementPrepaidMetadata = Pick<
  SettleSpaceSessionParams,
  | 'grouponCode'
  | 'grouponPlatform'
  | 'voucherCode'
  | 'voucherPlatform'
  | 'voucherFaceAmount'
  | 'skipPrepaidVoucherPersistence'
>;

/**
 * 构建结算所需的团购/券元数据——两条结账路径（手工结账 / 自动结账）的唯一权威实现。
 *
 * 历史上 `space-session-checkout.service` 与 `space-session-auto-checkout.service`
 * 各写了一份几乎逐行相同的回退链，改一处容易漏另一处，这里是收敛后的版本。
 *
 * 团购码/券码回退链（三级，由高到低）：
 *   1. checkoutPayload —— 手工结账请求的显式入参（自动结账场景无此层）
 *   2. session.prepaid* —— 开台预付快照
 *   3. renewGrouponFallback —— 续费记录中提取的最新团购信息
 *
 * voucherFaceAmount 回退链在此基础上多一条不变量（BUG-3 fix）：
 * 只有从「续费记录回退」时才带 `skipPrepaidVoucherPersistence: true`，
 * 防止续费券面金额被写回 session.prepaidVoucherFaceAmount 污染预付池，
 * 保持「预付池 / 续费池」两池独立。
 */
export const buildSettlementPrepaidMetadata = (params: {
  /** 手工结账的显式入参；自动结账传 undefined 即退化为两级回退 */
  checkoutPayload?: {
    grouponCode?: string;
    grouponPlatform?: string;
    voucherCode?: string;
    voucherPlatform?: string;
    voucherFaceAmount?: number;
  };
  /** 开台预付快照（分） */
  session: {
    prepaidGrouponCode: string | null;
    prepaidGrouponPlatform: string | null;
    prepaidVoucherCode: string | null;
    prepaidVoucherPlatform: string | null;
    prepaidVoucherFaceAmount: number | null;
  };
  /** 由 resolveRenewRecordsGrouponFallback 解析出的续费回退值（元） */
  renewGrouponFallback: ReturnType<typeof resolveRenewRecordsGrouponFallback>;
}): SettlementPrepaidMetadata => {
  const { checkoutPayload, session, renewGrouponFallback } = params;

  const grouponCode =
    checkoutPayload?.grouponCode ??
    session.prepaidGrouponCode ??
    renewGrouponFallback.grouponCode;
  const grouponPlatform =
    checkoutPayload?.grouponPlatform ??
    session.prepaidGrouponPlatform ??
    renewGrouponFallback.grouponPlatform;
  const voucherCode =
    checkoutPayload?.voucherCode ??
    session.prepaidVoucherCode ??
    renewGrouponFallback.grouponCode;
  const voucherPlatform =
    checkoutPayload?.voucherPlatform ??
    session.prepaidVoucherPlatform ??
    renewGrouponFallback.grouponPlatform;

  // 券面金额三选一：payload > 开台预付快照（分 → 元）> 续费回退（标记跳过持久化）
  let voucherFaceAmountTier: Pick<
    SettlementPrepaidMetadata,
    'voucherFaceAmount' | 'skipPrepaidVoucherPersistence'
  > = {};
  if (checkoutPayload?.voucherFaceAmount !== undefined) {
    voucherFaceAmountTier = {
      voucherFaceAmount: checkoutPayload.voucherFaceAmount,
    };
  } else if (session.prepaidVoucherFaceAmount !== null) {
    voucherFaceAmountTier = {
      voucherFaceAmount: Money.fromDbCents(
        session.prepaidVoucherFaceAmount,
      ).toOutputYuan(),
    };
  } else if (renewGrouponFallback.voucherFaceAmount !== undefined) {
    voucherFaceAmountTier = {
      voucherFaceAmount: renewGrouponFallback.voucherFaceAmount,
      skipPrepaidVoucherPersistence: true,
    };
  }

  return {
    ...(grouponCode ? { grouponCode } : {}),
    ...(grouponPlatform ? { grouponPlatform } : {}),
    ...(voucherCode ? { voucherCode } : {}),
    ...(voucherPlatform ? { voucherPlatform } : {}),
    ...voucherFaceAmountTier,
  };
};
