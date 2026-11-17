// ─── 营销域枚举值常量 & 类型（与前端枚举逐字对齐）─────────────────────
//
// 本文件只放运行时常量与其字面量类型，纯数据、无副作用；
// `marketing.utils.ts` 通过 `export *` 再导出，既有 import 路径保持不变。

// ─── 前端对齐的枚举值常量 ─────────────────────────────────────────────

/** 顾客会员等级（与前端 CustomerTier 完全一致）*/
export const MARKETING_CUSTOMER_TIER_VALUES = [
  'regular',
  'gold',
  'diamond',
] as const;
export type MarketingCustomerTierValue =
  (typeof MARKETING_CUSTOMER_TIER_VALUES)[number];

/** 顾客状态（根据加入门店时间与最后消费时间计算，不存库，与前端 CustomerStatus 完全一致）*/
export const MARKETING_CUSTOMER_STATUS_VALUES = [
  'new',
  'active',
  'dormant',
  'lost',
] as const;
export type MarketingCustomerStatus =
  (typeof MARKETING_CUSTOMER_STATUS_VALUES)[number];

/** 充值记录类型（与前端 RechargeType 完全一致）*/
export const MARKETING_RECHARGE_TYPE_VALUES = [
  'recharge',
  'gift',
  'refund',
] as const;
export type MarketingRechargeTypeValue =
  (typeof MARKETING_RECHARGE_TYPE_VALUES)[number];

/** 消费支付方式（与前端 PayType 完全一致）*/
export const MARKETING_PAY_TYPE_VALUES = [
  'balance',
  'cash',
  'wechat',
  'alipay',
  'mixed',
] as const;
export type MarketingPayTypeValue = (typeof MARKETING_PAY_TYPE_VALUES)[number];

/** 积分流水类型（与前端 CustomerPointsChangeType 完全一致）*/
export const MARKETING_POINTS_CHANGE_TYPE_VALUES = [
  'earn',
  'spend',
  'expire',
  'gift',
] as const;
export type MarketingPointsChangeTypeValue =
  (typeof MARKETING_POINTS_CHANGE_TYPE_VALUES)[number];

// ─── 枚举运行时安全校验（F7）─────────────────────────────────────

/**
 * 将未知字符串安全地转换为已知枚举值，遇到脏数据时返回 fallback 而非静默透传。
 */
export function safeEnumCoerce<T extends string>(
  value: string,
  allowed: readonly T[],
  fallback: T,
): T {
  return (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/** 活动类型（与前端 PromotionType 完全一致）*/
export const MARKETING_PROMOTION_TYPE_VALUES = [
  'discount',
  'reduce',
  'recharge_gift',
  'first_order_discount',
  'free',
  'points_2x',
  'points_recharge',
  'discount_day',
  'daily_check_in',
] as const;
export type MarketingPromotionTypeValue =
  (typeof MARKETING_PROMOTION_TYPE_VALUES)[number];

/** 活动类型唯一性冲突文案：create / update / P2002 兜底共用，避免口径分叉 */
export const PROMOTION_TYPE_CONFLICT_MESSAGE =
  '当前门店已存在相同类型的活动（含未上架），请直接编辑现有活动';

export type MarketingPromotionParamValue =
  | string
  | number
  | boolean
  | null
  | MarketingPromotionParamValue[]
  | { [key: string]: MarketingPromotionParamValue };

export type MarketingPromotionParamsValue = Record<
  string,
  MarketingPromotionParamValue
>;

/** 活动状态（前端按时间计算，不存库，与前端 PromotionStatus 完全一致）*/
export const MARKETING_PROMOTION_STATUS_VALUES = [
  'upcoming',
  'active',
  'ended',
] as const;
export type MarketingPromotionStatus =
  (typeof MARKETING_PROMOTION_STATUS_VALUES)[number];

/** 产品排序方式（与前端 MarketingProductSortBy 完全一致） */
export const MARKETING_PRODUCT_SORT_VALUES = [
  'createdAt',
  'name',
  'price_asc',
  'price_desc',
] as const;
export type MarketingProductSortValue =
  (typeof MARKETING_PRODUCT_SORT_VALUES)[number];

/** 商品类型：service=服务商品，voucher=团购券商品（支付后生成团购券） */
export const MARKETING_PRODUCT_TYPE_VALUES = ['service', 'voucher'] as const;
export type MarketingProductTypeValue =
  (typeof MARKETING_PRODUCT_TYPE_VALUES)[number];

/** 开台计费方式（团购券商品预配置，与空间域 BillingMode 语义一致） */
export const MARKETING_PRODUCT_BILLING_MODE_VALUES = [
  'items',
  'timed',
  'mixed',
  'countdown',
] as const;
export type MarketingProductBillingModeValue =
  (typeof MARKETING_PRODUCT_BILLING_MODE_VALUES)[number];

/**
 * 服务时长上限（分钟）：此前只在前端限制，接口直调可写任意值，
 * 这里抽常量供 Create/Update DTO 共用，与前端录入页 max 对齐。
 */
export const MARKETING_PRODUCT_MAX_DURATION_MINUTES = 600;
