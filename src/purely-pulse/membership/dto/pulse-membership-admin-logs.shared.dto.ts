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

/**
 * 纯利豆流水 Tab 筛选值：与 purelyPulse partnerBeans 页四个 Tab 一一对应。
 *
 * 语义之所以用 Tab 而不是 type/source 自由组合，是因为「获得 / 消耗提现」两个 Tab
 * 都要求排除管理员调整 —— 拆成两个独立参数无法表达这种排除关系。仅 beans/logs 生效。
 */
export const PULSE_ADMIN_MEMBER_BEAN_TAB_VALUES = [
  'all',
  'admin',
  'earn',
  'spend',
] as const;
export type PulseAdminMemberBeanTabValue =
  (typeof PULSE_ADMIN_MEMBER_BEAN_TAB_VALUES)[number];

/**
 * 积分流水 Tab 筛选值：与 purelyPulse memberPoints 页四个 Tab 一一对应。
 *
 * 与纯利豆 Tab 同构，语义必须对齐 `buildPulseAdminPointsLogItem` 的 type 推导：
 * type = source==='expire' ? 'expire' : changeType==='increase' ? 'earn' : 'spend'。
 * 仅 points/logs 生效。
 */
export const PULSE_ADMIN_MEMBER_POINTS_TAB_VALUES = [
  'all',
  'admin',
  'earn',
  'spend',
] as const;
export type PulseAdminMemberPointsTabValue =
  (typeof PULSE_ADMIN_MEMBER_POINTS_TAB_VALUES)[number];

/** 纯利豆流水关键词最长位数（合伙人姓名 / 手机号 / 流水说明）。 */
export const PULSE_ADMIN_MEMBER_LOG_MAX_KEYWORD_LENGTH = 32;
