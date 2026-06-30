// ─── MarketingMemberLevelSetting JSON 字段的 Zod Schema ───────────
//
// levels: 会员等级配置数组
// pointsRatio: 积分兑换/获取配置
// 读取时用 .safeParse() + 默认值兜底，写入时用 .parse() 严格校验。

import { z } from 'zod';
import {
  MARKETING_MEMBER_LEVEL_ID_VALUES,
  DEFAULT_MARKETING_MEMBER_LEVEL_SETTINGS,
  type MarketingMemberLevelIdValue,
} from '../marketing.utils';

// ─── levels ───────────────────────────────────────────────────────

export const memberLevelConfigSchema = z.object({
  id: z.enum(
    MARKETING_MEMBER_LEVEL_ID_VALUES as unknown as [
      MarketingMemberLevelIdValue,
      ...MarketingMemberLevelIdValue[],
    ],
  ),
  name: z.string().min(1),
  /** 内部折扣率 0~1 */
  discountRate: z.number().min(0.01).max(0.99),
  /** 折扣率百分比 1~99 */
  discountRatePct: z.number().int().min(1).max(99).optional(),
  spendThreshold: z.number().int().min(0),
  description: z.string(),
  enabled: z.boolean(),
  updatedAt: z.number().int().min(0),
});

export const memberLevelsSchema = z
  .array(memberLevelConfigSchema)
  .min(1)
  .default(DEFAULT_MARKETING_MEMBER_LEVEL_SETTINGS.levels);

// ─── pointsRatio ──────────────────────────────────────────────────

export const pointsRatioConfigSchema = z.object({
  earnRatioCents: z.number().int().min(1),
  earnRatioYuan: z.number().int().min(1).optional(),
  redeemRatioPoints: z.number().int().min(1),
  maxRedeemRatio: z.number().min(0.01).max(1),
  maxRedeemPct: z.number().int().min(1).max(100).optional(),
  enabled: z.boolean(),
  updatedAt: z.number().int().min(0),
});

export const pointsRatioSchema = pointsRatioConfigSchema.default(
  DEFAULT_MARKETING_MEMBER_LEVEL_SETTINGS.pointsRatio,
);

// ─── 整体 settings ────────────────────────────────────────────────

export const memberLevelSettingsSchema = z.object({
  levels: memberLevelsSchema,
  pointsRatio: pointsRatioSchema,
});

export type MemberLevelConfig = z.infer<typeof memberLevelConfigSchema>;
export type PointsRatioConfig = z.infer<typeof pointsRatioConfigSchema>;
export type MemberLevelSettings = z.infer<typeof memberLevelSettingsSchema>;

// ─── 校验入口 ─────────────────────────────────────────────────────

/**
 * 安全解析 levels JSON，校验失败返回默认值
 */
export function safeParseLevels(raw: unknown): MemberLevelConfig[] {
  const result = memberLevelsSchema.safeParse(raw);
  if (!result.success) {
    return DEFAULT_MARKETING_MEMBER_LEVEL_SETTINGS.levels;
  }
  return result.data;
}

/**
 * 安全解析 pointsRatio JSON，校验失败返回默认值
 */
export function safeParsePointsRatio(raw: unknown): PointsRatioConfig {
  const result = pointsRatioSchema.safeParse(raw);
  if (!result.success) {
    return DEFAULT_MARKETING_MEMBER_LEVEL_SETTINGS.pointsRatio;
  }
  return result.data;
}

/**
 * 安全解析整体 settings，校验失败返回默认值
 */
export function safeParseMemberLevelSettings(
  raw: { levels: unknown; pointsRatio: unknown } | null,
): MemberLevelSettings {
  if (!raw) {
    return DEFAULT_MARKETING_MEMBER_LEVEL_SETTINGS;
  }
  return memberLevelSettingsSchema.parse({
    levels: safeParseLevels(raw.levels),
    pointsRatio: safeParsePointsRatio(raw.pointsRatio),
  });
}
