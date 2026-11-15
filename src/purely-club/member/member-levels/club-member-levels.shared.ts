import Decimal from 'decimal.js';
import type { MarketingMemberLevelConfigValue } from '../../../purely-profit/marketing/marketing.utils';
import { safeParseLevels } from '../../../purely-profit/marketing/schemas/member-level-settings.schema';
import type {
  ClubMemberHeldLevelValue,
  ClubMemberLevelValue,
} from '../dto/club-member-account.dto';

export type ClubMemberLevelSettingRecord = {
  levels: unknown;
};

export interface ClubMemberLevelResolution {
  heldLevel: ClubMemberHeldLevelValue;
  heldLevelLabel: string;
  heldLevelVisible: boolean;
  currentLevelConfig: import('../dto/club-member-account.dto').ClubMemberLevelConfigDto;
  visibleLevelConfigs: import('../dto/club-member-account.dto').ClubMemberLevelConfigDto[];
}

export const CLUB_MEMBER_HELD_LEVEL_LABEL_MAP: Record<
  ClubMemberHeldLevelValue,
  string
> = {
  regular: '普通会员',
  gold: '黄金会员',
  platinum: '铂金会员',
  diamond: '钻石会员',
};

export const CLUB_MEMBER_LEVEL_META: Record<
  ClubMemberLevelValue,
  {
    color: string;
    bgColor: string;
    extraBenefits: string[];
  }
> = {
  regular: {
    color: '#8c8c8c',
    bgColor: '#f5f5f5',
    extraBenefits: ['充值即可升级享会员折扣'],
  },
  gold: {
    color: '#b7862f',
    bgColor: '#fbf3df',
    extraBenefits: ['优先预约通道', '会员成长专属提醒'],
  },
  platinum: {
    color: '#9f67d4',
    bgColor: '#f3efff',
    extraBenefits: ['热门时段优先预约', '专属会员活动通知'],
  },
  diamond: {
    color: '#6fa8ff',
    bgColor: '#ecf4ff',
    extraBenefits: ['高峰时段优先保障', '专属会员福利提醒'],
  },
};

/* ──────────────── 纯计算 / 格式化工具函数 ──────────────── */

export function normalizeRate(rate: number): number {
  return new Decimal(rate).toDecimalPlaces(2).toNumber();
}

export function formatDiscountLabel(discountRate: number): string {
  const discount = new Decimal(discountRate).mul(10).toDecimalPlaces(1);
  const normalized = discount.isInteger()
    ? discount.toFixed(0)
    : discount.toFixed(1);
  return `${normalized}折会员专属价`;
}

export function formatDiscountShortText(discountRate: number): string {
  const discount = new Decimal(discountRate).mul(10).toDecimalPlaces(1);
  const normalized = discount.isInteger()
    ? discount.toFixed(0)
    : discount.toFixed(1);
  return `${normalized}折`;
}

export function formatAmount(amount: number): string {
  const decimal = new Decimal(amount).toDecimalPlaces(2);
  return decimal.isInteger() ? decimal.toFixed(0) : decimal.toFixed(2);
}

export function calculateAmountToNextLevel(
  totalConsume: number,
  nextRequiredConsume: number,
): number {
  return Decimal.max(0, new Decimal(nextRequiredConsume).minus(totalConsume))
    .toDecimalPlaces(2)
    .toNumber();
}

export function calculateProgressPct(
  totalConsume: number,
  currentRequiredConsume: number,
  nextRequiredConsume: number,
): number {
  const span = new Decimal(nextRequiredConsume).minus(currentRequiredConsume);
  if (span.lte(0)) {
    // 门槛相同的相邻等级（如 regular → 「充值即享」的 gold，两者门槛均为 0）：
    // 尚未产生任何消费时进度应为 0，否则未充值用户会看到满格进度条。
    return totalConsume > 0 && totalConsume >= nextRequiredConsume ? 100 : 0;
  }

  return Decimal.min(
    100,
    Decimal.max(
      0,
      new Decimal(totalConsume)
        .minus(currentRequiredConsume)
        .div(span)
        .mul(100)
        .toDecimalPlaces(2),
    ),
  ).toNumber();
}

/* ──────────────── 等级配置归一化（纯函数，供 service 读写共用） ──────────────── */

/**
 * 把 `marketing_member_level_settings.levels` 归一化成稳定的等级配置数组。
 *
 * 口径：以默认配置的等级集合与顺序为骨架，用库里的同 id 配置覆盖；
 * 库里缺失或单条非法的等级回落到默认值。Zod 整体解析失败时退化为手写归一化，
 * 保证历史脏数据不会让整个等级体系不可用。
 *
 * 纯函数、无 this 依赖，因此从 service 外移（3-B-2 附带，便于缓存值与实时读取
 * 走同一份实现，避免两处口径漂移）。
 */
export function normalizeMemberLevels(
  settings: ClubMemberLevelSettingRecord | null,
  fallbackLevels: MarketingMemberLevelConfigValue[],
): MarketingMemberLevelConfigValue[] {
  // 优先使用 Zod schema 解析
  if (settings?.levels) {
    const parsedLevels = safeParseLevels(settings.levels);
    if (parsedLevels.length > 0) {
      return fallbackLevels.map((fallbackLevel) => {
        const matched = parsedLevels.find(
          (item) => item.id === fallbackLevel.id,
        );
        return matched
          ? {
              ...fallbackLevel,
              ...matched,
              id: fallbackLevel.id,
            }
          : { ...fallbackLevel };
      });
    }
  }

  // Zod 解析失败，回退到手写归一化
  const rawLevels = Array.isArray(settings?.levels) ? settings.levels : [];

  return fallbackLevels.map((fallbackLevel) => {
    const found = rawLevels.find(
      (item) =>
        !!item &&
        typeof item === 'object' &&
        !Array.isArray(item) &&
        (item as Record<string, unknown>).id === fallbackLevel.id,
    );
    const matched =
      found && typeof found === 'object' && !Array.isArray(found)
        ? (found as Record<string, unknown>)
        : undefined;

    const discountRate =
      typeof matched?.discountRate === 'number'
        ? matched.discountRate
        : fallbackLevel.discountRate;

    return {
      id: fallbackLevel.id,
      name:
        typeof matched?.name === 'string' && matched.name.trim().length > 0
          ? matched.name.trim()
          : fallbackLevel.name,
      discountRate,
      discountRatePct:
        typeof matched?.discountRatePct === 'number'
          ? matched.discountRatePct
          : Math.round(discountRate * 100),
      spendThreshold:
        typeof matched?.spendThreshold === 'number'
          ? Math.max(0, Math.round(matched.spendThreshold))
          : fallbackLevel.spendThreshold,
      description:
        typeof matched?.description === 'string' &&
        matched.description.trim().length > 0
          ? matched.description.trim()
          : fallbackLevel.description,
      enabled:
        typeof matched?.enabled === 'boolean'
          ? matched.enabled
          : fallbackLevel.enabled,
      updatedAt:
        typeof matched?.updatedAt === 'number'
          ? matched.updatedAt
          : fallbackLevel.updatedAt,
    };
  });
}
