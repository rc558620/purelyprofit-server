// ─── 会员等级配置（类型、默认值、工具函数）──────────────────────────────
//
// 从 marketing.utils.ts 抽离，存放会员等级 & 积分比例的全部类型定义与默认值。

// ─── 会员等级配置 ID（与前端 member-level 页面一致） ─────────────────────

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
        description: '充值即享 9 折优惠',
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
