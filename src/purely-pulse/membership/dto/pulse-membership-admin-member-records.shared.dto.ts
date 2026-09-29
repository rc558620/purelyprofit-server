/**
 * 会员记录管理（member-records）共享常量与取值。
 *
 * 四类记录来自三张表，前端「记录设置模块」的口径在这里定死：
 * - recharge      商家端下单充值          → store_membership_orders（paymentChannel=wechat）
 * - adminGrant    管理端设置会员等级      → store_membership_orders（paymentChannel=admin / gift）
 * - renewalAdjust 调整续费价              → store_membership_price_override_audits
 * - subAccount    子账号额度设置          → store_sub_account_quota_audits
 */
export const PULSE_ADMIN_MEMBER_RECORD_TYPE_VALUES = [
  'recharge',
  'adminGrant',
  'renewalAdjust',
  'subAccount',
] as const;
export type PulseAdminMemberRecordTypeValue =
  (typeof PULSE_ADMIN_MEMBER_RECORD_TYPE_VALUES)[number];

/** 会员等级筛选取值：与会员列表（members）的等级口径一致，库里 annual 存的是 yearly。 */
export const PULSE_ADMIN_MEMBER_RECORD_LEVEL_VALUES = [
  'lifetime',
  'annual',
  'quarterly',
  'monthly',
  'free',
] as const;
export type PulseAdminMemberRecordLevelValue =
  (typeof PULSE_ADMIN_MEMBER_RECORD_LEVEL_VALUES)[number];

/** 支付渠道：仅充值 / 等级设置两类有，其余类型下发 null。 */
export const PULSE_ADMIN_MEMBER_RECORD_CHANNEL_VALUES = [
  'wechat',
  'admin',
  'gift',
] as const;
export type PulseAdminMemberRecordChannelValue =
  (typeof PULSE_ADMIN_MEMBER_RECORD_CHANNEL_VALUES)[number];

/** 日期参数格式：`YYYY-MM-DD`（上海时区解析，见 dashboard-time.utils）。 */
export const PULSE_ADMIN_MEMBER_RECORD_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
