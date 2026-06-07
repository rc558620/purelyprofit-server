import { ConflictException } from '@nestjs/common';
import { DAY_MS } from './platform-membership.constants';
import type {
  MembershipPlanConfig,
  StoreMembershipProfileRecord,
} from './platform-membership.types';

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

export function isMembershipProfileActive(
  profile: Pick<StoreMembershipProfileRecord, 'currentPlanId' | 'startsAt' | 'expiresAt'>,
  nowMs: number = Date.now(),
): boolean {
  const expiredAt = resolveFrontendMembershipExpiry(profile)?.getTime() ?? null;

  if (profile.currentPlanId === 'lifetime' && profile.expiresAt === null) {
    return true;
  }

  return expiredAt !== null && expiredAt > nowMs;
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
