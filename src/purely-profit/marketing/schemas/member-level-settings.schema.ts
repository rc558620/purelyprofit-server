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
 * 安全解析 levels JSON。
 * B-M1 修复：逐条容错 —— 仅丢弃/兜底单条非法等级，不影响其余合法等级。
 * 仅当输入本身不是数组时，才整体回退为默认值。
 */
export function safeParseLevels(raw: unknown): MemberLevelConfig[] {
  if (!Array.isArray(raw)) {
    return DEFAULT_MARKETING_MEMBER_LEVEL_SETTINGS.levels;
  }

  const defaults = DEFAULT_MARKETING_MEMBER_LEVEL_SETTINGS.levels;
  const parsedById = new Map<string, MemberLevelConfig>();

  for (const item of raw) {
    const result = memberLevelConfigSchema.safeParse(item);
    if (
      result.success &&
      typeof (item as Record<string, unknown>)?.id === 'string'
    ) {
      parsedById.set(
        (item as Record<string, unknown>).id as string,
        result.data,
      );
    }
    // 单条非法 → 跳过，后续按 id 用默认值兜底
  }

  return defaults.map((def) => parsedById.get(def.id) ?? def);
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

// ─── 写入校验（B-M2）────────────────────────────────────────────

/**
 * 严格校验 levels 数组，写入前调用。
 * 任一元素非法即抛 ZodError，阻止脏数据落库。
 */
export function strictParseLevels(raw: unknown): MemberLevelConfig[] {
  return memberLevelConfigSchema.array().min(1).parse(raw);
}

/**
 * 严格校验 pointsRatio，写入前调用。
 */
export function strictParsePointsRatio(raw: unknown): PointsRatioConfig {
  return pointsRatioConfigSchema.parse(raw);
}
