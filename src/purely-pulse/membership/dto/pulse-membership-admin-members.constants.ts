// Pulse / 管理端会员模块共享常量
//
// 会员状态 / 等级、子账号角色 / 状态、列表筛选项、金额格式等取值口径集中在这里：
// 请求 DTO 用它做校验、服务层用它做落库与过滤，改口径只需改一处。

/**
 * 会员状态（对齐前端 MemberStatus）
 */
export const PULSE_MEMBER_STATUS_VALUES = [
  'active',
  'inactive',
  'banned',
] as const;

/**
 * 会员等级（对齐前端 MemberLevel）
 */
export const PULSE_MEMBER_LEVEL_VALUES = [
  'free',
  'monthly',
  'quarterly',
  'annual',
  'lifetime',
] as const;

/**
 * 充值支付渠道（对齐前端 RechargeRecord.channel）
 *
 * - wechat / alipay / card：商家端支付充值
 * - admin：管理端设置会员等级，且勾选了「计入收入」
 * - gift：管理端设置会员等级，按赠送处理（不计入营收，金额显示「赠送」）
 */
export const PULSE_RECHARGE_CHANNEL_VALUES = [
  'wechat',
  'alipay',
  'card',
  'admin',
  'gift',
] as const;

/** 子账号角色（对齐前端 MemberSubAccount.role） */
export const PULSE_SUB_ACCOUNT_ROLE_VALUES = [
  'cashier',
  'finance',
  'manager',
] as const;

/** 子账号状态（对齐前端 MemberSubAccount.status） */
export const PULSE_SUB_ACCOUNT_STATUS_VALUES = [
  'active',
  'inactive',
  'disabled',
] as const;

/* ────────────────── 金额格式 ────────────────── */

/**
 * 最多两位小数的**非负数**：放行 `0`。
 *
 * 用于「子账号加价 0 元」「续费价 0 = 该档位免费」这类「明确填了 0」的场景，
 * 它跟「没填」是两回事。
 */
export const PULSE_AMOUNT_NON_NEGATIVE_PATTERN = /^\d+(\.\d{1,2})?$/;

/**
 * 最多两位小数的**正数**：`0` / `0.0` / `0.00` 一律拒绝。
 *
 * 放行 0 会在服务端被当成「未填价」回落到**配置价**（`resolvePriceFen('0')` 返回 null），
 * 勾了「计入收入」就等于按全价记一笔营收——运营明明没收钱。
 */
export const PULSE_AMOUNT_POSITIVE_PATTERN =
  /^(?!0+(?:\.0{1,2})?$)\d+(\.\d{1,2})?$/;

/* ────────────────── 列表分页 ────────────────── */

/** 会员列表单页最大条数（与会员记录 limit 上限保持一致口径）。 */
export const PULSE_ADMIN_MEMBER_LIST_MAX_PAGE_SIZE = 100;
/** 会员列表默认单页条数。 */
export const PULSE_ADMIN_MEMBER_LIST_DEFAULT_PAGE_SIZE = 20;

/* ────────────────── 列表筛选 ────────────────── */

/**
 * 会员列表筛选状态（对齐前端 MemberFilterStatus / MemberFilterLevel）
 */
export const PULSE_MEMBER_FILTER_STATUS_VALUES = [
  'all',
  'active',
  'inactive',
  'banned',
] as const;
export type PulseMemberFilterStatusValue =
  (typeof PULSE_MEMBER_FILTER_STATUS_VALUES)[number];

export const PULSE_MEMBER_FILTER_LEVEL_VALUES = [
  'all',
  'free',
  'monthly',
  'quarterly',
  'annual',
  'lifetime',
] as const;
export type PulseMemberFilterLevelValue =
  (typeof PULSE_MEMBER_FILTER_LEVEL_VALUES)[number];

/**
 * 会员到期时间筛选（对齐前端 MemberFilterExpiry）
 */
export const PULSE_MEMBER_FILTER_EXPIRY_VALUES = [
  'all',
  '1m',
  '3m',
  '6m',
  '1y',
  '2y',
] as const;
export type PulseMemberFilterExpiryValue =
  (typeof PULSE_MEMBER_FILTER_EXPIRY_VALUES)[number];

/* ────────────────── 套餐档位与锁价 ────────────────── */

/** 套餐档位标识（与 Prisma MembershipPlanCycle 对齐） */
export const PULSE_MEMBERSHIP_PLAN_ID_VALUES = [
  'monthly',
  'quarterly',
  'yearly',
  'lifetime',
] as const;
export type PulseMembershipPlanIdValue =
  (typeof PULSE_MEMBERSHIP_PLAN_ID_VALUES)[number];

/** 锁价来源：purchase=商家端下单成交，admin=平台侧设置会员等级成交 */
export const PULSE_LOCKED_PRICE_SOURCE_VALUES = ['purchase', 'admin'] as const;
export type PulseLockedPriceSourceValue =
  (typeof PULSE_LOCKED_PRICE_SOURCE_VALUES)[number];
