import { resolveMembershipLevel } from '../../purely-profit/member/platform-membership/membership-expiry.utils';
import { MEMBER_ONLINE_WINDOW_MS } from './membership.constants';
import type {
  PulseAdminMembershipProfileRecord,
  PulseMemberStatusValue,
} from './membership.types';

/**
 * 判断会员订阅是否仍处于有效状态。
 *
 * ⚠️ 统一委托给 `membership-expiry.utils` 的 `resolveMembershipLevel`，
 * 不在此处另写一份——管理端与商家端口径一旦漂移，同一个门店会在两侧
 * 显示相反的会员状态（曾出现过：这里说 lifetime 永不过期，
 * 商家端却已按 expiresAt 判为到期）。
 */
export function isPulseMemberActive(
  profile: PulseAdminMembershipProfileRecord | null,
): boolean {
  if (!profile?.currentPlanId) {
    return false;
  }

  return (
    resolveMembershipLevel({
      currentPlanId: profile.currentPlanId,
      startsAt: profile.startsAt ?? null,
      expiresAt: profile.expiresAt,
    }) !== 'free'
  );
}

/**
 * 会员展示状态：注销 > 封禁 > 订阅是否有效。
 *
 * ⚠️ 列表与详情共用同一份判定，避免两处各写一遍嵌套三元后口径漂移。
 */
export function resolveAdminMemberStatus(
  store: { deletedAt?: Date | null },
  banReason: string | null,
  profile: PulseAdminMembershipProfileRecord | null,
): PulseMemberStatusValue {
  if (store.deletedAt) {
    return 'cancelled';
  }

  if (banReason) {
    return 'banned';
  }

  return isPulseMemberActive(profile) ? 'active' : 'inactive';
}

/**
 * 是否「在线」：只看账号最近一次鉴权请求，不看展示用的兜底值。
 *
 * ⚠️ 不能用 `lastActiveAt` 的展示兜底（最近充值时间 / 门店更新时间）判断，
 * 否则「刚充过值但没登录」会被误判为在线。
 */
export function resolveMemberOnline(
  lastActiveAt: Date | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (!lastActiveAt) {
    return false;
  }

  return nowMs - lastActiveAt.getTime() <= MEMBER_ONLINE_WINDOW_MS;
}
