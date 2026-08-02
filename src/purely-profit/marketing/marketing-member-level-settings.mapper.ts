import { Prisma } from '@prisma/client';
import type {
  MarketingMemberLevelDto,
  MarketingPointsRatioDto,
} from './dto/marketing-response.dto';
import {
  getReadOnlyDefaultMarketingMemberLevelSettings,
  type MarketingMemberLevelConfigValue,
  type MarketingMemberLevelSettingsValue,
  type MarketingPointsRatioConfigValue,
} from './marketing.utils';
import {
  safeParseLevels,
  safeParsePointsRatio,
} from './schemas/member-level-settings.schema';

export type MarketingMemberLevelSettingRecord = {
  levels: Prisma.JsonValue;
  pointsRatio: Prisma.JsonValue;
};

/** 将 DB 原始 JSON 记录归一化为内部配置值（缺省/脏数据回退默认值） */
export function normalizeMemberLevelSettings(
  settings: MarketingMemberLevelSettingRecord | null,
): MarketingMemberLevelSettingsValue {
  const fallback = getReadOnlyDefaultMarketingMemberLevelSettings();
  if (!settings) {
    return { ...fallback };
  }

  // 使用 Zod schema 解析 levels
  const parsedLevels = safeParseLevels(settings.levels);

  // 将 Zod 解析结果与默认值按 id 合并（保持默认值兜底）
  return {
    levels: fallback.levels.map((defaultLevel) => {
      const matched = parsedLevels.find((item) => item.id === defaultLevel.id);
      return matched
        ? {
            ...defaultLevel,
            ...matched,
            id: defaultLevel.id,
            // 兼容旧数据：若 DB 无 discountRatePct，则从 discountRate 推导
            discountRatePct:
              matched.discountRatePct ??
              Math.round(
                (matched.discountRate ?? defaultLevel.discountRate) * 100,
              ),
          }
        : { ...defaultLevel };
    }),
    pointsRatio: normalizePointsRatio(
      settings.pointsRatio,
      fallback.pointsRatio,
    ),
  };
}

/** 将 DB 原始 pointsRatio JSON 归一化为内部配置值 */
export function normalizePointsRatio(
  raw: Prisma.JsonValue,
  fallback: MarketingPointsRatioConfigValue,
): MarketingPointsRatioConfigValue {
  // 优先使用 Zod schema 解析
  const parsed = safeParsePointsRatio(raw);
  if (parsed) {
    return {
      earnRatioCents: parsed.earnRatioCents,
      earnRatioYuan: parsed.earnRatioYuan ?? parsed.earnRatioCents,
      redeemRatioPoints: parsed.redeemRatioPoints,
      maxRedeemRatio: parsed.maxRedeemRatio,
      maxRedeemPct:
        parsed.maxRedeemPct ?? Math.round(parsed.maxRedeemRatio * 100),
      enabled: parsed.enabled,
      updatedAt: parsed.updatedAt,
    };
  }

  // Zod 解析失败，回退到手写归一化
  const normalized =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? raw
      : ({} as Record<string, unknown>);

  const earnRatioCents =
    typeof normalized.earnRatioCents === 'number'
      ? Math.max(1, Math.round(normalized.earnRatioCents))
      : fallback.earnRatioCents;
  const maxRedeemRatio =
    typeof normalized.maxRedeemRatio === 'number'
      ? normalized.maxRedeemRatio
      : fallback.maxRedeemRatio;

  return {
    earnRatioCents,
    earnRatioYuan: earnRatioCents, // 单位一致，均为元
    redeemRatioPoints:
      typeof normalized.redeemRatioPoints === 'number'
        ? Math.max(1, Math.round(normalized.redeemRatioPoints))
        : fallback.redeemRatioPoints,
    maxRedeemRatio,
    maxRedeemPct: Math.round(maxRedeemRatio * 100),
    enabled:
      typeof normalized.enabled === 'boolean'
        ? normalized.enabled
        : fallback.enabled,
    updatedAt:
      typeof normalized.updatedAt === 'number'
        ? normalized.updatedAt
        : fallback.updatedAt,
  };
}

/** 将内部 level 值转为前端友好 DTO */
export function toMemberLevelDto(
  level: MarketingMemberLevelConfigValue,
): MarketingMemberLevelDto {
  return {
    id: level.id,
    name: level.name,
    discountRatePct: level.discountRatePct,
    spendThreshold: level.spendThreshold,
    description: level.description,
    enabled: level.enabled,
    updatedAt: level.updatedAt,
  };
}

/** 将内部 pointsRatio 值转为前端友好 DTO */
export function toPointsRatioDto(
  ratio: MarketingPointsRatioConfigValue,
): MarketingPointsRatioDto {
  return {
    earnRatioYuan: ratio.earnRatioYuan,
    redeemRatioPoints: ratio.redeemRatioPoints,
    maxRedeemPct: ratio.maxRedeemPct,
    enabled: ratio.enabled,
    updatedAt: ratio.updatedAt,
  };
}
