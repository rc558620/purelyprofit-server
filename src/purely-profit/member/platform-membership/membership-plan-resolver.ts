import { ConflictException } from '@nestjs/common';
import type { PlatformMembershipPlanId } from './dto/platform-membership-query.dto';
import {
  PLAN_BADGE_CONFIG,
  PLAN_LEVEL_RANK,
} from './platform-membership.constants';
import {
  buildPlanExpiryAt,
  isMembershipProfileActive,
  resolveFrontendMembershipExpiry,
} from './membership-expiry.utils';
import type {
  MembershipPlanConfig,
  MembershipPlanSettingRecord,
  StoreMembershipOrderRecord,
  StoreMembershipProfileRecord,
} from './platform-membership.types';

export function normalizeMembershipProfileFromPaidOrders(params: {
  profile: StoreMembershipProfileRecord;
  paidOrders: Pick<StoreMembershipOrderRecord, 'planId' | 'createdAt'>[];
  plans: Pick<MembershipPlanConfig, 'id' | 'name' | 'durationMonths' | 'validDays'>[];
  nowMs?: number;
}): StoreMembershipProfileRecord {
  const { profile, paidOrders, plans, nowMs = Date.now() } = params;

  if (isMembershipProfileActive(profile, nowMs) || paidOrders.length === 0) {
    return profile;
  }

  const rebuiltSnapshot = rebuildMembershipProfileFromPaidOrders({
    paidOrders,
    plans,
  });
  if (!rebuiltSnapshot || !isMembershipProfileActive(rebuiltSnapshot, nowMs)) {
    return profile;
  }

  return {
    ...profile,
    ...rebuiltSnapshot,
  };
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

function rebuildMembershipProfileFromPaidOrders(params: {
  paidOrders: Pick<StoreMembershipOrderRecord, 'planId' | 'createdAt'>[];
  plans: Pick<MembershipPlanConfig, 'id' | 'name' | 'durationMonths' | 'validDays'>[];
}): Pick<StoreMembershipProfileRecord, 'currentPlanId' | 'startsAt' | 'expiresAt'> | null {
  const { paidOrders, plans } = params;
  const planById = new Map(plans.map((plan) => [plan.id, plan]));
  const orderedPaidOrders = [...paidOrders].sort(
    (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
  );

  let snapshot: Pick<StoreMembershipProfileRecord, 'currentPlanId' | 'startsAt' | 'expiresAt'> = {
    currentPlanId: null,
    startsAt: null,
    expiresAt: null,
  };

  for (const order of orderedPaidOrders) {
    const plan = planById.get(order.planId);
    if (!plan) {
      continue;
    }

    const orderTime = order.createdAt.getTime();
    const currentExpiryMs =
      resolveFrontendMembershipExpiry(snapshot)?.getTime() ?? 0;
    const baseMs = currentExpiryMs > orderTime ? currentExpiryMs : orderTime;
    const currentActivePlanId =
      currentExpiryMs > orderTime ? snapshot.currentPlanId : null;

    snapshot = {
      currentPlanId: resolveEffectivePlanId(currentActivePlanId, order.planId),
      startsAt: snapshot.startsAt ?? order.createdAt,
      expiresAt: buildPlanExpiryAt(plan, baseMs),
    };
  }

  return snapshot.currentPlanId ? snapshot : null;
}
