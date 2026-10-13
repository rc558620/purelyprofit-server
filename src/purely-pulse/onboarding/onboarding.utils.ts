import type { MembershipPlanCycle } from '@prisma/client';
import type { PlatformMembershipPlanId } from '../../purely-profit/member/platform-membership/dto/platform-membership-query.dto';
import { resolveMembershipLevel } from '../../purely-profit/member/platform-membership/membership-expiry.utils';

export interface MerchantVerificationRow {
  realName: string | null;
  idNumber: string | null;
}

export interface MembershipProfileRow {
  currentPlanId: MembershipPlanCycle | null;
  startsAt: Date | null;
  expiresAt: Date | null;
}

/**
 * 判断会员订阅是否仍处于有效状态。
 *
 * ⚠️ 这里**不再**自己实现过期判断，统一委托给
 * `membership-expiry.utils` 的 `resolveMembershipLevel`。
 *
 * 过去这里有一份私有副本，判定成「lifetime 永不过期」，而 profit 侧的
 * `resolveMembershipLevel` 判定成「lifetime 按 expiresAt 正常到期」——
 * 同一个 AGES 门店，管理端 onboarding 说有会员、商家端却已被降级拦截。
 * 语义相反的两份实现比任何一份的错误都难排查，必须收敛到一处。
 */
export function isActiveMembership(
  profile: MembershipProfileRow | null,
): boolean {
  if (!profile?.currentPlanId) {
    return false;
  }

  return (
    resolveMembershipLevel({
      currentPlanId: profile.currentPlanId as PlatformMembershipPlanId,
      startsAt: profile.startsAt,
      expiresAt: profile.expiresAt,
    }) !== 'free'
  );
}
