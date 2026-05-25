import { PLATFORM_MEMBERSHIP_PLAN_IDS } from '../../purely-profit/member/platform-membership/dto/platform-membership-query.dto';

export const DAY_MS = 24 * 60 * 60 * 1000;
export const POINTS_RATE = 100;
export const POINTS_DEDUCT_LIMIT = 0.3;
export const BEAN_DEDUCT_RATE = 100;
export const BEAN_DEDUCT_LIMIT = 0.5;
export const PULSE_MEMBERSHIP_BAN_REASON_KEY_PREFIX =
  'pulse:membership:admin:member:';

export const PURCHASE_BONUS_POINTS: Record<
  (typeof PLATFORM_MEMBERSHIP_PLAN_IDS)[number],
  number
> = {
  monthly: 0,
  quarterly: 300,
  yearly: 1500,
  lifetime: 0,
};
