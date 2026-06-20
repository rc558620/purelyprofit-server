import type { MembershipPlanCycle } from '@prisma/client';

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
 * 对齐 `isMembershipProfileActive`（membership-expiry.utils.ts）的判定逻辑：
 * - lifetime 计划永不过期，即使 expiresAt 因脏数据或 730 天默认值过期也不应影响判定
 * - 历史兼容：早年 lifetime 枚举还没加时用 yearly + null expiresAt 表示永久会员，
 *   需同时满足 startsAt 存在才认定为 lifetime，防止数据异常被误判
 * - 其他计划正常检查 expiresAt 是否晚于当前时间
 */
export function isActiveMembership(
  profile: MembershipProfileRow | null,
): boolean {
  if (!profile?.currentPlanId) {
    return false;
  }

  // lifetime 计划永不过期
  if (profile.currentPlanId === 'lifetime') {
    return true;
  }

  // 历史兼容：yearly + null expiresAt + startsAt 存在 → 视为 lifetime
  if (
    profile.currentPlanId === 'yearly' &&
    profile.expiresAt === null &&
    profile.startsAt !== null
  ) {
    return true;
  }

  if (!profile.expiresAt) {
    return false;
  }

  return profile.expiresAt > new Date();
}
