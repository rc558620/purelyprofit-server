// ─── 营销中心工具函数 & 类型（纯函数，无副作用）────────────────────────
//
// 这里存放的是不含装饰器的共享类型和工具函数，供 service / mapper 直接 import，
// 避免把 dto class 当作 service 内部共享类型中心（参见后端踩坑记录 坑9）。

import { Money } from '../../shared/money.utils';

// ─── 前端对齐的枚举值常量 ─────────────────────────────────────────────

/** 顾客会员等级（与前端 CustomerTier 完全一致）*/
export const MARKETING_CUSTOMER_TIER_VALUES = [
  'regular',
  'gold',
  'diamond',
] as const;
export type MarketingCustomerTierValue =
  (typeof MARKETING_CUSTOMER_TIER_VALUES)[number];

/** 顾客状态（根据最后消费时间计算，不存库，与前端 CustomerStatus 完全一致）*/
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
  /** 内部折扣率 0~1（如 0.9 = 9 折），仅用于存储与内部计算 */
  discountRate: number;
  /** 折扣率百分比 1~99（如 90 = 9 折），API 响应/入参使用 */
  discountRatePct: number;
  /** 升级消费门槛，单位：元 */
  spendThreshold: number;
  description: string;
  enabled: boolean;
  updatedAt: number;
}

export interface MarketingPointsRatioConfigValue {
  /** 内部存储名，单位实际为元（如 100 = 消费 100 元得 1 积分）；仅用于存储 */
  earnRatioCents: number;
  /** API 响应/入参字段：每消费多少元得 1 积分 */
  earnRatioYuan: number;
  redeemRatioPoints: number;
  /** 内部抵扣比例 0~1（如 0.5 = 50%），仅用于存储与内部计算 */
  maxRedeemRatio: number;
  /** API 响应/入参字段：最大抵扣百分比 1~100（如 50 = 50%） */
  maxRedeemPct: number;
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
        discountRatePct: 90,
        spendThreshold: 0,
        description: '注册即享 9 折优惠',
        enabled: true,
        updatedAt: 0,
      },
      {
        id: 'platinum',
        name: '铂金会员',
        discountRate: 0.85,
        discountRatePct: 85,
        spendThreshold: 5000, // 单位：元（与 API 响应单位一致）
        description: '累计充值 ≥ ¥5,000 升级',
        enabled: true,
        updatedAt: 0,
      },
      {
        id: 'diamond',
        name: '钻石会员',
        discountRate: 0.8,
        discountRatePct: 80,
        spendThreshold: 10000, // 单位：元（与 API 响应单位一致）
        description: '累计充值 ≥ ¥10,000 升级',
        enabled: true,
        updatedAt: 0,
      },
    ],
    pointsRatio: {
      earnRatioCents: 100,
      earnRatioYuan: 100,
      redeemRatioPoints: 1,
      maxRedeemRatio: 0.5,
      maxRedeemPct: 50,
      enabled: false,
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

/** 各等级最低累计消费金额门槛（分），仅作为无配置时的兆底值 */
export const TIER_THRESHOLDS: Record<MarketingCustomerTierValue, number> = {
  regular: 0,
  gold: 200000,
  diamond: 1000000,
};

/**
 * 从存储的会员等级设置中提取 tier 阈值（分）。
 * 将设置层的 gold/platinum/diamond 映射为顾客 tier 层的 regular/gold/diamond：
 *  - gold tier 门槛 ← platinum.spendThreshold（第二级）
 *  - diamond tier 门槛 ← diamond.spendThreshold（第三级）
 */
export function extractTierThresholdsFromSettings(
  levels: ReadonlyArray<{ id: string; spendThreshold: number }>,
): Pick<Record<MarketingCustomerTierValue, number>, 'gold' | 'diamond'> {
  const platinum = levels.find((l) => l.id === 'platinum');
  const diamond = levels.find((l) => l.id === 'diamond');
  return {
    gold: (platinum?.spendThreshold ?? TIER_THRESHOLDS.gold / 100) * 100,
    diamond: (diamond?.spendThreshold ?? TIER_THRESHOLDS.diamond / 100) * 100,
  };
}

/**
 * 根据累计消费金额（分）计算顾客等级。
 * 可传入自定义阈值（从会员等级设置中读取），未传时使用硬编码兆底值。
 */
export function calcCustomerTier(
  totalSpent: number,
  thresholds?: { gold?: number; diamond?: number },
): MarketingCustomerTierValue {
  const goldThreshold = thresholds?.gold ?? TIER_THRESHOLDS.gold;
  const diamondThreshold = thresholds?.diamond ?? TIER_THRESHOLDS.diamond;
  if (totalSpent >= diamondThreshold) return 'diamond';
  if (totalSpent >= goldThreshold) return 'gold';
  return 'regular';
}

// ─── 顾客状态计算（和前端 calcCustomerStatus 完全一致）────────────────

/**
 * 根据最后消费时间计算顾客状态
 * - 从未消费（null）：new
 * - 30 天内有消费：active
 * - 30~90 天：dormant
 * - 90 天以上：lost
 */
export function calcCustomerStatus(
  lastVisitAt: Date | null,
): MarketingCustomerStatus {
  if (!lastVisitAt) return 'new';
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

// ─── 手机号归一化 & 脱敏 ──────────────────────────────────────────────

/**
 * 手机号归一化：去除国家码 +86、空格、连字符等非数字字符，
 * 返回纯 11 位国内手机号；无法归一化时返回 null。
 */
export function normalizePhone(
  phone: string | null | undefined,
): string | null {
  if (!phone) return null;
  // 去除所有非数字字符
  let digits = phone.replace(/\D/g, '');
  // 去除中国国家码 86（如果以 86 开头且总长度 > 11）
  if (digits.startsWith('86') && digits.length > 11) {
    digits = digits.slice(2);
  }
  // 中国大陆手机号固定 11 位
  if (digits.length !== 11) return null;
  return digits;
}

/**
 * 手机号脱敏：138****0001
 * 先归一化，再保留前 3 位和后 4 位，中间用 **** 替代。
 * 无法归一化的号码返回空字符串。
 */
export function maskPhone(phone: string | null): string {
  const normalized = normalizePhone(phone);
  if (!normalized) return '';
  return `${normalized.slice(0, 3)}****${normalized.slice(-4)}`;
}

// ─── 充值金额合计 ──────────────────────────────────────────────────────
// 注意：totalAmount 已在数据库 marketing_recharges.total_amount 列存储，
// 新代码应直接读取 totalAmount 字段，不再手动 amount + giftAmount。
// 此函数仅作兜底兼容，待确认无调用方后可移除。

/** @deprecated 新代码应直接读取 totalAmount 字段，不再手动计算 */
export function calcRechargeTotal(amount: number, giftAmount: number): number {
  return Money.fromDbCents(amount)
    .add(Money.fromDbCents(giftAmount))
    .toDbCents();
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
