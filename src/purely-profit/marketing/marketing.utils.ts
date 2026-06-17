// ─── 营销中心工具函数 & 类型（纯函数，无副作用）────────────────────────
//
// 这里存放的是不含装饰器的共享类型和工具函数，供 service / mapper 直接 import，
// 避免把 dto class 当作 service 内部共享类型中心（参见后端踩坑记录 坑9）。

// ─── 前端对齐的枚举值常量 ─────────────────────────────────────────────

/** 顾客会员等级（与前端 CustomerTier 完全一致）*/
export const MARKETING_CUSTOMER_TIER_VALUES = [
  'regular',
  'silver',
  'gold',
  'diamond',
] as const;
export type MarketingCustomerTierValue =
  (typeof MARKETING_CUSTOMER_TIER_VALUES)[number];

/** 顾客状态（根据最后消费时间计算，不存库，与前端 CustomerStatus 完全一致）*/
export const MARKETING_CUSTOMER_STATUS_VALUES = [
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
] as const;
export type MarketingPromotionTypeValue =
  (typeof MARKETING_PROMOTION_TYPE_VALUES)[number];

/** 会员等级配置 ID（与前端 member-level 页面一致） */
export const MARKETING_MEMBER_LEVEL_ID_VALUES = [
  'gold',
  'platinum',
  'diamond',
] as const;
export type MarketingMemberLevelIdValue =
  (typeof MARKETING_MEMBER_LEVEL_ID_VALUES)[number];

export interface MarketingMemberLevelConfigValue {
  id: MarketingMemberLevelIdValue;
  name: string;
  discountRate: number;
  spendThreshold: number;
  description: string;
  enabled: boolean;
  updatedAt: number;
}

export interface MarketingPointsRatioConfigValue {
  earnRatioCents: number;
  redeemRatioPoints: number;
  maxRedeemRatio: number;
  enabled: boolean;
  updatedAt: number;
}

export interface MarketingMemberLevelSettingsValue {
  levels: MarketingMemberLevelConfigValue[];
  pointsRatio: MarketingPointsRatioConfigValue;
}

export const DEFAULT_MARKETING_MEMBER_LEVEL_SETTINGS: MarketingMemberLevelSettingsValue =
  {
    levels: [
      {
        id: 'gold',
        name: '黄金会员',
        discountRate: 0.9,
        spendThreshold: 0,
        description: '注册即享 9 折优惠',
        enabled: true,
        updatedAt: 0,
      },
      {
        id: 'platinum',
        name: '铂金会员',
        discountRate: 0.9,
        spendThreshold: 500000,
        description: '累计充值 ≥ ¥5,000 升级',
        enabled: true,
        updatedAt: 0,
      },
      {
        id: 'diamond',
        name: '钻石会员',
        discountRate: 0.8,
        spendThreshold: 1000000,
        description: '累计充值 ≥ ¥10,000 升级',
        enabled: true,
        updatedAt: 0,
      },
    ],
    pointsRatio: {
      earnRatioCents: 100,
      redeemRatioPoints: 1,
      maxRedeemRatio: 0.5,
      enabled: true,
      updatedAt: 0,
    },
  };

/**
 * Returns a read-only reference to the default settings.
 * Use this for read-only consumption (e.g. fallback values in normalization).
 * For mutable copies, use cloneDefaultMarketingMemberLevelSettings() instead.
 */
export function getReadOnlyDefaultMarketingMemberLevelSettings(): Readonly<MarketingMemberLevelSettingsValue> {
  return DEFAULT_MARKETING_MEMBER_LEVEL_SETTINGS;
}

export function cloneDefaultMarketingMemberLevelSettings(): MarketingMemberLevelSettingsValue {
  return {
    levels: DEFAULT_MARKETING_MEMBER_LEVEL_SETTINGS.levels.map((level) => ({
      ...level,
    })),
    pointsRatio: {
      ...DEFAULT_MARKETING_MEMBER_LEVEL_SETTINGS.pointsRatio,
    },
  };
}

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

// ─── 分页 ─────────────────────────────────────────────────────────────

export interface MarketingPaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface MarketingResolvedPagination {
  page: number;
  skip: number;
  take: number;
}

export function resolveMarketingPagination(
  page: number | undefined,
  pageSize: number | undefined,
  defaultPageSize = 20,
  maxPageSize = 100,
): MarketingResolvedPagination {
  const safePage = page && page > 0 ? page : 1;
  const safeSize = pageSize && pageSize > 0 ? pageSize : defaultPageSize;
  const take = Math.min(safeSize, maxPageSize);
  return { page: safePage, skip: (safePage - 1) * take, take };
}

export function buildMarketingPaginationMeta(
  total: number,
  page: number,
  pageSize: number,
): MarketingPaginationMeta {
  return {
    page,
    pageSize,
    total,
    totalPages: Math.max(Math.ceil(total / pageSize), 1),
  };
}

// ─── 顾客等级计算（和前端 calcCustomerTier 完全一致，分为单位）────────

/** 各等级最低累计消费金额门槛（分） */
const TIER_THRESHOLDS: Record<MarketingCustomerTierValue, number> = {
  regular: 0,
  silver: 50000,
  gold: 200000,
  diamond: 1000000,
};

/**
 * 根据累计消费金额（分）计算顾客等级
 * 对齐前端 calcCustomerTier：diamond >= 1000000 > gold >= 200000 > silver >= 50000
 */
export function calcCustomerTier(
  totalSpent: number,
): MarketingCustomerTierValue {
  if (totalSpent >= TIER_THRESHOLDS.diamond) return 'diamond';
  if (totalSpent >= TIER_THRESHOLDS.gold) return 'gold';
  if (totalSpent >= TIER_THRESHOLDS.silver) return 'silver';
  return 'regular';
}

// ─── 顾客状态计算（和前端 calcCustomerStatus 完全一致）────────────────

/**
 * 根据最后消费时间计算顾客状态
 * - 30 天内有消费：active
 * - 30~90 天：dormant
 * - 90 天以上或 null：lost
 */
export function calcCustomerStatus(
  lastVisitAt: Date | null,
): MarketingCustomerStatus {
  if (!lastVisitAt) return 'lost';
  const daysSince =
    (Date.now() - lastVisitAt.getTime()) / (1000 * 60 * 60 * 24);
  if (daysSince <= 30) return 'active';
  if (daysSince <= 90) return 'dormant';
  return 'lost';
}

// ─── 活动状态计算（和前端 calcPromotionStatus 完全一致）────────────────

/**
 * 根据开始/结束时间计算活动状态
 */
export function calcPromotionStatus(
  startAt: Date,
  endAt: Date,
): MarketingPromotionStatus {
  const now = Date.now();
  if (now < startAt.getTime()) return 'upcoming';
  if (now > endAt.getTime()) return 'ended';
  return 'active';
}

// ─── 手机号脱敏（保留前 3 位和后 4 位，中间用 **** 替代）──────────────

/**
 * 手机号脱敏：138****0001
 * 仅对 11 位手机号处理，其他格式原样返回
 */
export function maskPhone(phone: string | null): string {
  if (!phone) return '';
  const trimmed = phone.trim();
  if (trimmed.length === 11) {
    return `${trimmed.slice(0, 3)}****${trimmed.slice(-4)}`;
  }
  return trimmed;
}

// ─── 充值金额合计（前端 amount + giftAmount）──────────────────────────

export function calcRechargeTotal(amount: number, giftAmount: number): number {
  return amount + giftAmount;
}

// ─── service 层内部 query 类型（不直接依赖 DTO class）────────────────

export interface CustomerListQuery {
  storeId: number;
  status?: MarketingCustomerStatus;
  keyword?: string;
  page?: number;
  pageSize?: number;
}

export interface RechargeListQuery {
  storeId: number;
  customerId?: number;
  /** createdAt 开始时间（ms 时间戳，包含） */
  startMs?: number;
  /** createdAt 结束时间（ms 时间戳，包含） */
  endMs?: number;
  page?: number;
  pageSize?: number;
}

export interface ConsumptionListQuery {
  storeId: number;
  customerId: number;
  page?: number;
  pageSize?: number;
}

export interface PointsRecordListQuery {
  storeId: number;
  customerId?: number;
  type?: MarketingPointsChangeTypeValue;
  startMs?: number;
  endMs?: number;
  page?: number;
  pageSize?: number;
}

export interface PromotionListQuery {
  storeId: number;
  status?: MarketingPromotionStatus;
  page?: number;
  pageSize?: number;
}

export interface ProductListQuery {
  storeId: number;
  categoryId?: number;
  sortBy?: MarketingProductSortValue;
}

export interface OverviewQuery {
  storeId: number;
}
