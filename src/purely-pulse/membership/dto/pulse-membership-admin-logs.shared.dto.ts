export function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export const PULSE_ADMIN_MEMBER_POINTS_TYPE_VALUES = [
  'earn',
  'spend',
  'expire',
] as const;
export type PulseAdminMemberPointsTypeValue =
  (typeof PULSE_ADMIN_MEMBER_POINTS_TYPE_VALUES)[number];

export const PULSE_ADMIN_MEMBER_LOG_DEFAULT_LIMIT = 20;
export const PULSE_ADMIN_MEMBER_LOG_MAX_LIMIT = 100;

export const PULSE_ADMIN_MEMBER_POINTS_SOURCE_VALUES = [
  'purchase_bonus',
  'deduct_payment',
  'admin_adjust',
  'expire',
] as const;
export type PulseAdminMemberPointsSourceValue =
  (typeof PULSE_ADMIN_MEMBER_POINTS_SOURCE_VALUES)[number];

export const PULSE_ADMIN_MEMBER_BEAN_TYPE_VALUES = [
  'earn',
  'spend',
  'withdraw',
] as const;
export type PulseAdminMemberBeanTypeValue =
  (typeof PULSE_ADMIN_MEMBER_BEAN_TYPE_VALUES)[number];

export const PULSE_ADMIN_MEMBER_BEAN_SOURCE_VALUES = [
  'promo_reward',
  'deduct_payment',
  'withdrawal',
  'admin_adjust',
] as const;
export type PulseAdminMemberBeanSourceValue =
  (typeof PULSE_ADMIN_MEMBER_BEAN_SOURCE_VALUES)[number];
