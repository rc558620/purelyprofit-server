import { ConflictException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { Money } from '../../../shared/money.utils';
import type {
  PlatformMembershipBeanLogDto,
  PlatformMembershipBeanLogsResponseDto,
  PlatformMembershipOrderResponseDto,
  PlatformMembershipOrdersOverviewDto,
  PlatformMembershipPointsLogDto,
  PlatformMembershipPointsLogsResponseDto,
} from './dto/platform-membership-response.dto';
import {
  BEAN_DEDUCT_LIMIT,
  BEAN_DEDUCT_RATE,
  POINTS_DEDUCT_LIMIT,
  POINTS_RATE,
} from './platform-membership.constants';
import type {
  BeanTypeValue,
  PaymentCalculationResult,
  PointsTypeValue,
  StoreMembershipOrderRecord,
  StoreMembershipPointsLogRecord,
  StorePartnerBeanLogRecord,
  StorePartnerRecord,
} from './platform-membership.types';

type ApprovedPartnerLike = Pick<
  StorePartnerRecord,
  'status' | 'beanBalance' | 'totalEarnedBeans' | 'totalWithdrawnBeans'
>;

export function buildOrdersOverview(
  orders: StoreMembershipOrderRecord[],
): PlatformMembershipOrdersOverviewDto {
  // 汇总金额直接使用数据库分值，不再做分→元转换；前端统一消费分
  const totalAmount = orders.reduce((sum, order) => sum + order.amount, 0);
  return {
    orderCount: orders.length,
    totalAmount,
  };
}

export function mapOrder(
  order: StoreMembershipOrderRecord,
): PlatformMembershipOrderResponseDto {
  return {
    id: String(order.id),
    planId: order.planId,
    planName: order.planName,
    amount: order.amount,
    pointsUsed: order.pointsUsed,
    beansUsed: order.beansUsed,
    status: order.status,
    createdAt: order.createdAt.getTime(),
    ...(order.paymentChannel === 'wechat' && order.paymentOrderId
      ? { wxOrderId: order.paymentOrderId }
      : {}),
  };
}

export function buildPointsOverview(
  availablePoints: number,
  logs: StoreMembershipPointsLogRecord[],
  pointsRate: number = POINTS_RATE,
): PlatformMembershipPointsLogsResponseDto['overview'] {
  const totalEarned = logs.reduce(
    (sum, log) =>
      log.changeType === 'increase' ? sum + log.changeAmount : sum,
    0,
  );
  const totalSpent = logs.reduce(
    (sum, log) =>
      log.changeType === 'decrease' ? sum + log.changeAmount : sum,
    0,
  );

  // 可抵扣金额（分）：⌊积分 / 比率⌋ × 100（1积分=1分，100积分=1元=100分）
  // 使用 Money 链路保证金额精度
  const deductibleAmount = Money.fromDbCents(
    new Decimal(availablePoints).div(pointsRate).floor().mul(100).toNumber(),
  ).toDbCents();
  const canUsePoints = availablePoints >= pointsRate;

  return {
    availablePoints,
    totalEarned,
    totalSpent,
    deductibleAmount,
    canUsePoints,
  };
}

export function mapPointsLog(
  log: StoreMembershipPointsLogRecord,
): PlatformMembershipPointsLogDto {
  const signedAmount =
    log.changeType === 'decrease' ? -log.changeAmount : log.changeAmount;
  return {
    id: `pts-${log.id}`,
    amount: signedAmount,
    type: resolvePointsType(log),
    source: log.source,
    description: log.description,
    createdAt: log.createdAt.getTime(),
    ...(log.expireAt ? { expireAt: log.expireAt.getTime() } : {}),
  };
}

export function buildBeanOverview(
  partners: ApprovedPartnerLike[],
): PlatformMembershipBeanLogsResponseDto['overview'] {
  const approvedPartners = partners.filter(
    (partner) => partner.status === 'approved',
  );

  const summary = approvedPartners.reduce(
    (acc, partner) => ({
      beanBalance: acc.beanBalance + partner.beanBalance,
      totalEarnedBeans: acc.totalEarnedBeans + partner.totalEarnedBeans,
      totalWithdrawnBeans:
        acc.totalWithdrawnBeans + partner.totalWithdrawnBeans,
    }),
    {
      beanBalance: 0,
      totalEarnedBeans: 0,
      totalWithdrawnBeans: 0,
    },
  );

  // 待结算纯利豆 = max(0, 总获得 - 总提现 - 当前余额)，防止因并发写入出现负数
  const pendingBeans = Math.max(
    0,
    summary.totalEarnedBeans - summary.totalWithdrawnBeans - summary.beanBalance,
  );

  return {
    ...summary,
    pendingBeans,
  };
}

export function mapBeanLog(
  log: StorePartnerBeanLogRecord,
): PlatformMembershipBeanLogDto {
  return {
    id: `bean-${log.id}`,
    amount: log.changeAmount,
    type: resolveBeanType(log),
    source: log.source,
    description: log.description,
    ...(log.relatedPromoRecordId
      ? { relatedPromoId: `promo-${log.relatedPromoRecordId}` }
      : {}),
    ...(log.relatedPlanType ? { relatedPlanType: log.relatedPlanType } : {}),
    ...(log.relatedUser ? { relatedUser: log.relatedUser } : {}),
    createdAt: log.createdAt.getTime(),
  };
}

export function resolvePointsType(
  log: StoreMembershipPointsLogRecord,
): PointsTypeValue {
  if (log.source === 'expire') {
    return 'expire';
  }

  return log.changeType === 'increase' ? 'earn' : 'spend';
}

export function resolveBeanType(log: StorePartnerBeanLogRecord): BeanTypeValue {
  if (log.source === 'withdrawal') {
    return 'withdraw';
  }

  return log.changeAmount >= 0 ? 'earn' : 'spend';
}

export function generateWechatOrderId(storeId: number, now: Date): string {
  return `WX${storeId}${now.getTime()}`;
}

export function requireApprovedPartnerOrNull(
  partner: StorePartnerRecord | null,
): StorePartnerRecord | null {
  if (!partner || partner.status !== 'approved') {
    return null;
  }

  return partner;
}

export function allocateBeansAcrossPartners(
  partners: StorePartnerRecord[],
  requestedBeans: number,
): Array<{ partnerId: number; beans: number }> {
  if (requestedBeans <= 0) {
    return [];
  }

  let remainingBeans = requestedBeans;
  const allocations: Array<{ partnerId: number; beans: number }> = [];

  for (const partner of partners) {
    if (partner.status !== 'approved' || partner.beanBalance <= 0) {
      continue;
    }

    const beans = Math.min(partner.beanBalance, remainingBeans);
    if (beans <= 0) {
      continue;
    }

    allocations.push({ partnerId: partner.id, beans });
    remainingBeans -= beans;

    if (remainingBeans === 0) {
      break;
    }
  }

  if (remainingBeans > 0) {
    throw new ConflictException('当前无可抵扣纯利豆');
  }

  return allocations;
}

export function calcPreviewResult(
  params: Parameters<typeof calcMemberPlanPayment>[0],
): {
  beanDeductAmount: number;
  actualBeansUsed: number;
  priceAfterBeans: number;
  pointsDeductAmount: number;
  actualPointsUsed: number;
  finalAmount: number;
  maxBeanDeductAmount: number;
  maxPointsDeductAmount: number;
  canUsePoints: boolean;
  canUseBeans: boolean;
} {
  const {
    planPrice,
    availablePoints,
    availableBeans,
    pointsRate = POINTS_RATE,
    pointsDeductLimitRate = POINTS_DEDUCT_LIMIT,
    beanDeductLimitRate = BEAN_DEDUCT_LIMIT,
  } = params;

  // 入口断言：planPrice 必须是整数分，全链路使用 Money 对象
  const planPriceMoney = Money.fromDbCents(planPrice);

  const maxBeanDeductAmount = planPriceMoney.multiply(beanDeductLimitRate);
  const canUseBeans = availableBeans >= 1;
  const maxPointsDeductOnFullPrice = planPriceMoney.multiply(pointsDeductLimitRate);
  const canUsePoints = availablePoints >= pointsRate;

  // 复用 calcMemberPlanPayment 得到实际抵扣明细
  const payment = calcMemberPlanPayment(params);

  return {
    ...payment,
    maxBeanDeductAmount: maxBeanDeductAmount.toDbCents(),
    maxPointsDeductAmount: Money.min(
      maxPointsDeductOnFullPrice,
      Money.fromDbCents(
        new Decimal(availablePoints).div(pointsRate).floor().mul(100).toNumber(),
      ),
    ).toDbCents(),
    canUsePoints,
    canUseBeans,
  };
}

export function calcMemberPlanPayment(params: {
  planPrice: number;
  requestedPoints: number;
  availablePoints: number;
  requestedBeans: number;
  availableBeans: number;
  pointsRate?: number;
  pointsDeductLimitRate?: number;
  beanDeductRate?: number;
  beanDeductLimitRate?: number;
}): PaymentCalculationResult {
  const {
    requestedPoints,
    availablePoints,
    requestedBeans,
    availableBeans,
    pointsRate = POINTS_RATE,
    pointsDeductLimitRate = POINTS_DEDUCT_LIMIT,
    beanDeductRate = BEAN_DEDUCT_RATE,
    beanDeductLimitRate = BEAN_DEDUCT_LIMIT,
  } = params;

  // 入口断言：planPrice 必须是整数分，全链路使用 Money 对象
  const planPriceMoney = Money.fromDbCents(params.planPrice);

  // ── 纯利豆抵扣计算 ────────────────────────────────────────────
  // 最大可抵扣金额 = 套餐原价 × 抵扣上限比例（向下取整到分）
  const maxBeanDeductAmount = planPriceMoney.multiply(beanDeductLimitRate);
  // 实际可抵扣 = min(请求数×兑换率, 最大抵扣额, 可用余额×兑换率)，下限为零
  const requestedBeanDeduct = Money.fromDbCents(
    new Decimal(requestedBeans).mul(beanDeductRate).toNumber(),
  );
  const availableBeanDeduct = Money.fromDbCents(
    new Decimal(availableBeans).mul(beanDeductRate).toNumber(),
  );
  const beanDeductAmount = Money.max(
    Money.zero(),
    Money.min(Money.min(requestedBeanDeduct, maxBeanDeductAmount), availableBeanDeduct),
  );
  // 实际消耗纯利豆 = 抵扣金额 ÷ 兑换率（向下取整）
  const actualBeansUsed = new Decimal(beanDeductAmount.toDbCents())
    .div(beanDeductRate)
    .floor()
    .toNumber();

  // ── 积分抵扣计算 ──────────────────────────────────────────────
  const priceAfterBeans = planPriceMoney.subtractClampedToZero(beanDeductAmount);
  // 最大积分抵扣金额 = 豆后价格 × 积分抵扣上限比例（向下取整到分）
  const maxPointsDeductAmount = priceAfterBeans.multiply(pointsDeductLimitRate);
  // 请求的积分抵扣 = ⌊请求积分数 / 比率⌋ × 100（向下取整到元转分）
  const requestedPointsDeduct = Money.fromDbCents(
    new Decimal(requestedPoints).div(pointsRate).floor().mul(100).toNumber(),
  );
  // 可用积分抵扣 = ⌊可用积分数 / 比率⌋ × 100
  const availablePointsDeduct = Money.fromDbCents(
    new Decimal(availablePoints).div(pointsRate).floor().mul(100).toNumber(),
  );
  const pointsDeductAmount = Money.max(
    Money.zero(),
    Money.min(Money.min(requestedPointsDeduct, availablePointsDeduct), maxPointsDeductAmount),
  );
  // 实际消耗积分 = 抵扣金额(分) / 100 × 比率
  const actualPointsUsed = new Decimal(pointsDeductAmount.toDbCents())
    .div(100)
    .mul(pointsRate)
    .toNumber();
  // 最终应付 = 豆后价格 - 积分抵扣额，下限为零
  const finalAmount = priceAfterBeans.subtractClampedToZero(pointsDeductAmount);

  // 出口断言：所有金额字段必须是整数分
  return {
    beanDeductAmount: beanDeductAmount.toDbCents(),
    actualBeansUsed,
    priceAfterBeans: priceAfterBeans.toDbCents(),
    pointsDeductAmount: pointsDeductAmount.toDbCents(),
    actualPointsUsed,
    finalAmount: finalAmount.toDbCents(),
  };
}
