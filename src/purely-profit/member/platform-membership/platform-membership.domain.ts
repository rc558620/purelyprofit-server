import { ConflictException } from '@nestjs/common';
import Decimal from 'decimal.js';
import type { PlatformMembershipPlanId } from './dto/platform-membership-query.dto';
import type {
  PlatformMembershipBeanLogDto,
  PlatformMembershipBeanLogsResponseDto,
  PlatformMembershipApprovedPartnerDto,
  PlatformMembershipOrderResponseDto,
  PlatformMembershipOrdersOverviewDto,
  PlatformMembershipPointsLogDto,
  PlatformMembershipPointsLogsResponseDto,
  PlatformMembershipProfileResponseDto,
} from './dto/platform-membership-response.dto';
import {
  BEAN_DEDUCT_LIMIT,
  BEAN_DEDUCT_RATE,
  DAY_MS,
  PLAN_BADGE_CONFIG,
  PLAN_LEVEL_RANK,
  POINTS_DEDUCT_LIMIT,
  POINTS_RATE,
} from './platform-membership.constants';
import type {
  BeanTypeValue,
  MembershipPlanConfig,
  MembershipPlanSettingRecord,
  PaymentCalculationResult,
  PointsTypeValue,
  StoreMembershipOrderRecord,
  StoreMembershipPointsLogRecord,
  StoreMembershipProfileRecord,
  StorePartnerBeanLogRecord,
  StorePartnerRecord,
} from './platform-membership.types';

export function buildProfileResponse(
  profile: StoreMembershipProfileRecord,
  partners: StorePartnerRecord[],
): PlatformMembershipProfileResponseDto {
  const primaryPartner = partners[0] ?? null;

  return {
    memberInfo: buildMembershipInfo(profile),
    approvedPartner: buildApprovedPartnerResponse(primaryPartner),
    approvedPartners: buildApprovedPartnersResponse(partners),
  };
}

export function buildMembershipInfo(
  profile: StoreMembershipProfileRecord,
): PlatformMembershipProfileResponseDto['memberInfo'] {
  const expiredAt = resolveFrontendMembershipExpiry(profile)?.getTime() ?? null;
  const isLegacyLifetimeMembership =
    profile.currentPlanId === 'yearly' && profile.expiresAt === null;
  const isActive =
    profile.currentPlanId === 'lifetime' && profile.expiresAt === null
      ? true
      : expiredAt !== null && expiredAt > Date.now();

  return {
    isActive,
    planId: isActive ? profile.currentPlanId : null,
    ...(isLegacyLifetimeMembership ? { displayPlanName: 'ages会员' } : {}),
    expiredAt,
    inviteCode: buildInviteCode(profile.storeId),
    totalPoints: profile.totalPoints,
    availablePoints: profile.availablePoints,
  };
}

export function resolveFrontendMembershipExpiry(
  profile: Pick<
    StoreMembershipProfileRecord,
    'currentPlanId' | 'startsAt' | 'expiresAt'
  >,
): Date | null {
  if (profile.expiresAt) {
    return profile.expiresAt;
  }

  if (profile.currentPlanId === 'yearly') {
    const baseTime = profile.startsAt?.getTime() ?? Date.now();
    return new Date(baseTime + 730 * DAY_MS);
  }

  return null;
}

export function buildPlanExpiryAt(
  plan: Pick<MembershipPlanConfig, 'name' | 'durationMonths' | 'validDays'>,
  baseMs: number,
): Date {
  if (plan.durationMonths !== null && plan.durationMonths > 0) {
    return new Date(baseMs + plan.durationMonths * 30 * DAY_MS);
  }

  if (plan.validDays !== null && plan.validDays > 0) {
    return new Date(baseMs + plan.validDays * DAY_MS);
  }

  throw new ConflictException(`${plan.name}套餐配置缺少有效时长`);
}

type ApprovedPartnerLike = Pick<
  StorePartnerRecord,
  | 'id'
  | 'name'
  | 'phone'
  | 'joinedAt'
  | 'beanBalance'
  | 'totalEarnedBeans'
  | 'totalWithdrawnBeans'
> & {
  status: string;
};

type BeanOverviewPartnerLike = Pick<
  ApprovedPartnerLike,
  'status' | 'beanBalance' | 'totalEarnedBeans' | 'totalWithdrawnBeans'
>;

export function buildApprovedPartnerResponse(
  partner: ApprovedPartnerLike | null,
): PlatformMembershipProfileResponseDto['approvedPartner'] {
  if (!partner || partner.status !== 'approved') {
    return null;
  }

  return {
    id: String(partner.id),
    name: partner.name ?? '',
    phone: partner.phone ?? '',
    ...(partner.joinedAt ? { joinedAt: partner.joinedAt.getTime() } : {}),
    beanBalance: partner.beanBalance,
    totalEarnedBeans: partner.totalEarnedBeans,
    totalWithdrawnBeans: partner.totalWithdrawnBeans,
  };
}

export function buildApprovedPartnersResponse(
  partners: ApprovedPartnerLike[],
): PlatformMembershipApprovedPartnerDto[] {
  return partners
    .filter((partner) => partner.status === 'approved')
    .map((partner) => ({
      id: String(partner.id),
      name: partner.name ?? '',
      phone: partner.phone ?? '',
      ...(partner.joinedAt ? { joinedAt: partner.joinedAt.getTime() } : {}),
      beanBalance: partner.beanBalance,
      totalEarnedBeans: partner.totalEarnedBeans,
      totalWithdrawnBeans: partner.totalWithdrawnBeans,
    }));
}

export function buildOrdersOverview(
  orders: StoreMembershipOrderRecord[],
): PlatformMembershipOrdersOverviewDto {
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
    pointsDeducted: order.pointsDeducted,
    pointsUsed: order.pointsUsed,
    beanDeducted: order.beanDeducted,
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
  partners: BeanOverviewPartnerLike[],
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

export function toPlanConfig(
  setting: MembershipPlanSettingRecord,
): MembershipPlanConfig {
  if (setting.durationMonths !== null && setting.durationMonths > 0) {
    return {
      id: setting.planId as PlatformMembershipPlanId,
      name: setting.planName,
      price: setting.price,
      originalPrice: setting.originalPrice ?? setting.price,
      durationMonths: setting.durationMonths,
      validDays: setting.validDays,
      monthlyPrice: Math.floor(setting.price / setting.durationMonths),
      ...PLAN_BADGE_CONFIG[setting.planId as PlatformMembershipPlanId],
    };
  }

  if (setting.validDays !== null && setting.validDays > 0) {
    return {
      id: setting.planId as PlatformMembershipPlanId,
      name: setting.planName,
      price: setting.price,
      originalPrice: setting.originalPrice,
      durationMonths: setting.durationMonths,
      validDays: setting.validDays,
      ...PLAN_BADGE_CONFIG[setting.planId as PlatformMembershipPlanId],
    };
  }

  throw new ConflictException(`${setting.planName}套餐配置缺少有效时长`);
}

export function resolveEffectivePlanId(
  currentPlanId: PlatformMembershipPlanId | null,
  purchasedPlanId: PlatformMembershipPlanId,
): PlatformMembershipPlanId {
  if (!currentPlanId) {
    return purchasedPlanId;
  }

  return PLAN_LEVEL_RANK[purchasedPlanId] > PLAN_LEVEL_RANK[currentPlanId]
    ? purchasedPlanId
    : currentPlanId;
}

export function calcRemainingDays(
  profile: Pick<
    StoreMembershipProfileRecord,
    'currentPlanId' | 'startsAt' | 'expiresAt'
  >,
): number {
  const expiresAt = resolveFrontendMembershipExpiry(profile);
  if (!expiresAt) {
    return 0;
  }

  const diff = expiresAt.getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / DAY_MS));
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

function buildInviteCode(storeId: number): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let seed = storeId * 1103515245 + 12345;
  let inviteCode = '';

  for (let index = 0; index < 6; index += 1) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    inviteCode += alphabet[seed % alphabet.length];
  }

  return inviteCode;
}
