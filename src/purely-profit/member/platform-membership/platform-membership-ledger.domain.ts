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
  const totalAmount = Money.fromDbCents(orders.reduce((sum, order) => sum + order.amount, 0)).toOutputYuan();
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
    amount: Money.fromDbCents(order.amount).toOutputYuan(),
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
): PlatformMembershipPointsLogsResponseDto['overview'] {
  const totalEarned = logs.reduce(
    (sum, log) => (log.changeAmount > 0 ? sum + log.changeAmount : sum),
    0,
  );
  const totalSpent = logs.reduce(
    (sum, log) =>
      log.changeAmount < 0 ? sum + Math.abs(log.changeAmount) : sum,
    0,
  );

  return {
    availablePoints,
    totalEarned,
    totalSpent,
  };
}

export function mapPointsLog(
  log: StoreMembershipPointsLogRecord,
): PlatformMembershipPointsLogDto {
  return {
    id: `pts-${log.id}`,
    amount: log.changeAmount,
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

  return approvedPartners.reduce(
    (summary, partner) => ({
      beanBalance: summary.beanBalance + partner.beanBalance,
      totalEarnedBeans: summary.totalEarnedBeans + partner.totalEarnedBeans,
      totalWithdrawnBeans:
        summary.totalWithdrawnBeans + partner.totalWithdrawnBeans,
    }),
    {
      beanBalance: 0,
      totalEarnedBeans: 0,
      totalWithdrawnBeans: 0,
    },
  );
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

  return log.changeAmount >= 0 ? 'earn' : 'spend';
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
    planPrice,
    requestedPoints,
    availablePoints,
    requestedBeans,
    availableBeans,
    pointsRate = POINTS_RATE,
    pointsDeductLimitRate = POINTS_DEDUCT_LIMIT,
    beanDeductRate = BEAN_DEDUCT_RATE,
    beanDeductLimitRate = BEAN_DEDUCT_LIMIT,
  } = params;
  // planPrice 来自 MembershipPlanConfig.price，单位分；计算链路以分为单位
  const planPriceDecimal = new Decimal(planPrice);
  const zero = new Decimal(0);

  const maxBeanDeductAmount = planPriceDecimal.mul(beanDeductLimitRate).floor();
  const beanDeductAmount = Decimal.max(
    zero,
    Decimal.min(
      new Decimal(requestedBeans).mul(beanDeductRate),
      maxBeanDeductAmount,
      new Decimal(availableBeans).mul(beanDeductRate),
    ),
  );
  const actualBeansUsed = beanDeductAmount.div(beanDeductRate).floor();

  const priceAfterBeans = Decimal.max(
    zero,
    planPriceDecimal.minus(beanDeductAmount),
  );
  const maxPointsDeductAmount = priceAfterBeans
    .mul(pointsDeductLimitRate)
    .floor();
  const requestedPointsDeductAmount = new Decimal(requestedPoints)
    .div(pointsRate)
    .floor()
    .mul(100);
  const availablePointsDeductAmount = new Decimal(availablePoints)
    .div(pointsRate)
    .floor()
    .mul(100);
  const pointsDeductAmount = Decimal.max(
    zero,
    Decimal.min(
      requestedPointsDeductAmount,
      availablePointsDeductAmount,
      maxPointsDeductAmount,
    ),
  );
  const actualPointsUsed = pointsDeductAmount.div(100).mul(pointsRate);
  const finalAmount = Decimal.max(
    zero,
    priceAfterBeans.minus(pointsDeductAmount),
  );

  return {
    beanDeductAmount: beanDeductAmount.toNumber(),
    actualBeansUsed: actualBeansUsed.toNumber(),
    priceAfterBeans: priceAfterBeans.toNumber(),
    pointsDeductAmount: pointsDeductAmount.toNumber(),
    actualPointsUsed: actualPointsUsed.toNumber(),
    finalAmount: finalAmount.toNumber(),
  };
}
