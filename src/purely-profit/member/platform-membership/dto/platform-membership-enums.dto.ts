/** 会员订单状态枚举值 */
export const PLATFORM_MEMBERSHIP_ORDER_STATUS = [
  'pending',
  'paid',
  'failed',
  'refunded',
] as const;

/** 合伙人申请状态枚举值 */
export const PLATFORM_PARTNER_STATUS = [
  'pending',
  'reviewing',
  'approved',
  'rejected',
] as const;

/** 合伙人等级枚举值 */
export const PLATFORM_PARTNER_LEVEL_VALUES = [
  'star',
  'elite',
  'legend',
] as const;

/** 积分流水类型枚举值 */
export const PLATFORM_POINTS_RECORD_TYPES = [
  'earn',
  'spend',
  'expire',
] as const;

/** 积分流水来源枚举值 */
export const PLATFORM_POINTS_RECORD_SOURCES = [
  'purchase_bonus',
  'deduct_payment',
  'admin_adjust',
  'expire',
] as const;

/** 纯利豆流水类型枚举值 */
export const PLATFORM_BEAN_RECORD_TYPES = [
  'earn',
  'spend',
  'withdraw',
] as const;

/** 纯利豆流水来源枚举值 */
export const PLATFORM_BEAN_RECORD_SOURCES = [
  'promo_reward',
  'deduct_payment',
  'withdrawal',
  'admin_adjust',
] as const;
