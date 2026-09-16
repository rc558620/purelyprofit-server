import { PLATFORM_MEMBERSHIP_PLAN_IDS } from '../../purely-profit/member/platform-membership/dto/platform-membership-query.dto';

export const DAY_MS = 24 * 60 * 60 * 1000;
export const PULSE_MEMBERSHIP_BAN_REASON_KEY_PREFIX =
  'pulse:membership:admin:member:';

/**
 * 「在线」判定窗口（ms）。
 *
 * `users.last_active_at` 由鉴权链路异步写入，写入节流 5 分钟、用户信息缓存 TTL 5 分钟，
 * 因此活跃账号在库里的值最坏滞后约 10 分钟 —— 取 10 分钟窗口可保证「正在使用的账号
 * 稳定显示在线」，又不会把早已离线的人一直显示为在线。
 */
export const MEMBER_ONLINE_WINDOW_MS = 10 * 60 * 1000;

export const PURCHASE_BONUS_POINTS: Record<
  (typeof PLATFORM_MEMBERSHIP_PLAN_IDS)[number],
  number
> = {
  monthly: 0,
  quarterly: 300,
  yearly: 1500,
  lifetime: 0,
};
