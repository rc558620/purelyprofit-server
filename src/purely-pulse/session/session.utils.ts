import {
  resolveTimestamp,
  toIsoStringOrNull,
} from '../../shared/date-coerce.utils';
import { toOptionalMediaText } from '../../purely-profit/commerce/commerce.utils';
import type { PlatformMembershipPlanId } from '../../purely-profit/member/platform-membership/dto/platform-membership-query.dto';
import {
  resolveMembershipExpiry,
  resolveMembershipLevel,
} from '../../purely-profit/member/platform-membership/membership-expiry.utils';
import type { PulseTargetStoreSummary } from '../pulse-store-context.types';
import type {
  PulseSessionMembershipDto,
  PulseSessionStoreDto,
  PulseSessionUserDto,
} from './dto/session-bootstrap.dto';
import type { MembershipProfileRow, UserProfileRow } from './session.types';

const DAY_MS = 86_400_000;

/** 永不过期档位的剩余天数展示约定（-1 = 不限天数） */
const PERPETUAL_REMAINING_DAYS = -1;

export function buildUserDto(
  user: UserProfileRow,
  phone: string,
): PulseSessionUserDto {
  return {
    id: user.id,
    phone,
    name: user.name,
    avatar: toOptionalMediaText(user.avatar) ?? '',
    verified: Boolean(user.realName && user.idNumber),
  };
}

export function buildStoreDto(
  store: PulseTargetStoreSummary,
): PulseSessionStoreDto {
  return {
    id: store.id,
    name: store.name,
    address: store.address,
  };
}

export function buildMembershipDto(
  profile: MembershipProfileRow | null,
): PulseSessionMembershipDto {
  if (!profile || !profile.currentPlanId) {
    return {
      isActive: false,
      planId: null,
      planName: null,
      remainingDays: 0,
      expiresAt: null,
    };
  }

  // 整个 bootstrap 响应会进 Redis，回读后日期是字符串：统一转时间戳再归一化，
  // 否则 `.getTime()` 会在字符串上直接抛错
  const expiresAtMs = resolveTimestamp(profile.expiresAt, 0);
  const startsAtMs = resolveTimestamp(profile.startsAt, 0);

  // ⚠️ 过期判定统一委托给 membership-expiry.utils，不在此处另写一份。
  // 过去这里判定「lifetime 永不过期」，与商家端「lifetime 按 expiresAt 到期」
  // 语义相反，同一个门店在管理端与商家端会显示相反的会员状态。
  const resolved = resolveMembershipExpiry({
    currentPlanId: profile.currentPlanId as PlatformMembershipPlanId,
    startsAt: startsAtMs > 0 ? new Date(startsAtMs) : null,
    expiresAt: expiresAtMs > 0 ? new Date(expiresAtMs) : null,
  });
  const isActive =
    resolveMembershipLevel({
      currentPlanId: profile.currentPlanId as PlatformMembershipPlanId,
      startsAt: startsAtMs > 0 ? new Date(startsAtMs) : null,
      expiresAt: expiresAtMs > 0 ? new Date(expiresAtMs) : null,
    }) !== 'free';

  return {
    isActive,
    planId: profile.currentPlanId,
    planName: profile.planName,
    // 永不过期的档位沿用 -1 表示「不限天数」的既有展示约定
    remainingDays:
      resolved.source === 'perpetual'
        ? PERPETUAL_REMAINING_DAYS
        : calcRemainingDays(resolved.expiresAt?.getTime() ?? 0),
    expiresAt: toIsoStringOrNull(profile.expiresAt),
  };
}

/** 剩余天数：入参为到期时间戳，0 表示未开通（无到期时间） */
function calcRemainingDays(expiresAtMs: number): number {
  if (expiresAtMs <= 0) {
    return 0;
  }

  const diffMs = expiresAtMs - Date.now();
  if (diffMs <= 0) {
    return 0;
  }

  return Math.ceil(diffMs / DAY_MS);
}
