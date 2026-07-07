import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  cloneDefaultMarketingMemberLevelSettings,
  type MarketingMemberLevelConfigValue,
} from '../../../purely-profit/marketing/marketing.utils';
import { safeParseLevels } from '../../../purely-profit/marketing/schemas/member-level-settings.schema';
import type {
  ClubMemberHeldLevelValue,
  ClubMemberLevelConfigDto,
  ClubMemberLevelStatusDto,
  ClubMemberLevelValue,
} from '../dto/club-member-account.dto';
import type { ClubMemberSnapshot } from '../member-profile/club-member-profile.service';

type ClubMemberLevelSettingRecord = {
  levels: unknown;
};

export interface ClubMemberLevelResolution {
  heldLevel: ClubMemberHeldLevelValue;
  heldLevelLabel: string;
  heldLevelVisible: boolean;
  currentLevelConfig: ClubMemberLevelConfigDto;
  visibleLevelConfigs: ClubMemberLevelConfigDto[];
}

const CLUB_MEMBER_HELD_LEVEL_LABEL_MAP: Record<
  ClubMemberHeldLevelValue,
  string
> = {
  regular: '普通会员',
  gold: '黄金会员',
  platinum: '铂金会员',
  diamond: '钻石会员',
};

const CLUB_MEMBER_LEVEL_META: Record<
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

@Injectable()
export class ClubMemberLevelsService {
  constructor(private readonly prisma: PrismaService) {}

  async listConfigs(storeId: number): Promise<ClubMemberLevelConfigDto[]> {
    const levelSettings = await this.loadLevelSettings(storeId);
    return this.toActiveConfigDtos(levelSettings);
  }

  async resolveCurrentLevel(
    snapshot: ClubMemberSnapshot,
  ): Promise<ClubMemberLevelValue> {
    const resolution = await this.resolveLevelResolution(snapshot);
    return resolution.currentLevelConfig.level;
  }

  async resolveCurrentLevelConfig(
    snapshot: ClubMemberSnapshot,
  ): Promise<ClubMemberLevelConfigDto> {
    const resolution = await this.resolveLevelResolution(snapshot);
    return resolution.currentLevelConfig;
  }

  async resolveLevelResolution(
    snapshot: ClubMemberSnapshot,
  ): Promise<ClubMemberLevelResolution> {
    const levelSettings = await this.loadLevelSettings(snapshot.storeId);
    const visibleLevelConfigs = this.toActiveConfigDtos(levelSettings);
    const allLevelConfigs = levelSettings.map((levelSetting) =>
      this.toConfigDto(levelSetting),
    );
    const heldLevelConfig = allLevelConfigs.find(
      (config) => config.level === snapshot.level,
    );
    const fallbackLevel = this.resolveVisibleFallbackLevel(visibleLevelConfigs);
    const currentLevelConfig = this.findCurrentLevelConfig(
      visibleLevelConfigs,
      snapshot.totalConsume,
      fallbackLevel,
    );
    const heldLevelVisible = visibleLevelConfigs.some(
      (config) => config.level === snapshot.level,
    );

    return {
      heldLevel: snapshot.level,
      heldLevelLabel:
        heldLevelConfig?.label ??
        CLUB_MEMBER_HELD_LEVEL_LABEL_MAP[snapshot.level],
      heldLevelVisible,
      currentLevelConfig,
      visibleLevelConfigs,
    };
  }

  async buildLevelStatus(
    snapshot: ClubMemberSnapshot,
  ): Promise<ClubMemberLevelStatusDto> {
    const resolution = await this.resolveLevelResolution(snapshot);
    const { currentLevelConfig, heldLevel, heldLevelLabel, heldLevelVisible } =
      resolution;
    const configs = resolution.visibleLevelConfigs;
    const currentIndex = configs.findIndex(
      (config) => config.level === currentLevelConfig.level,
    );
    const nextLevelConfig =
      currentIndex >= 0 ? (configs[currentIndex + 1] ?? null) : null;

    if (!nextLevelConfig) {
      return {
        currentLevel: currentLevelConfig.level,
        currentLevelLabel: currentLevelConfig.label,
        currentRequiredConsume: currentLevelConfig.requiredConsume,
        totalConsume: snapshot.totalConsume,
        nextLevel: null,
        nextLevelLabel: null,
        nextRequiredConsume: null,
        amountToNextLevel: 0,
        progressPct: 100,
        isTopLevel: true,
        heldLevel,
        heldLevelLabel,
        heldLevelVisible,
      };
    }

    return {
      currentLevel: currentLevelConfig.level,
      currentLevelLabel: currentLevelConfig.label,
      currentRequiredConsume: currentLevelConfig.requiredConsume,
      totalConsume: snapshot.totalConsume,
      nextLevel: nextLevelConfig.level,
      nextLevelLabel: nextLevelConfig.label,
      nextRequiredConsume: nextLevelConfig.requiredConsume,
      amountToNextLevel: this.calculateAmountToNextLevel(
        snapshot.totalConsume,
        nextLevelConfig.requiredConsume,
      ),
      progressPct: this.calculateProgressPct(
        snapshot.totalConsume,
        currentLevelConfig.requiredConsume,
        nextLevelConfig.requiredConsume,
      ),
      isTopLevel: false,
      heldLevel,
      heldLevelLabel,
      heldLevelVisible,
    };
  }

  private async loadLevelSettings(
    storeId: number,
  ): Promise<MarketingMemberLevelConfigValue[]> {
    const fallback = cloneDefaultMarketingMemberLevelSettings();
    const settings = await this.prisma.marketingMemberLevelSetting.findUnique({
      where: { storeId },
      select: {
        levels: true,
      },
    });

    return this.normalizeMemberLevels(settings, fallback.levels);
  }

  private normalizeMemberLevels(
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

  private toActiveConfigDtos(
    levelSettings: MarketingMemberLevelConfigValue[],
  ): ClubMemberLevelConfigDto[] {
    const effectiveLevels = levelSettings.filter(
      (levelSetting) => levelSetting.enabled || levelSetting.id === 'gold',
    );

    return effectiveLevels.map((levelSetting) =>
      this.toConfigDto(levelSetting),
    );
  }

  private toConfigDto(
    levelSetting: MarketingMemberLevelConfigValue,
  ): ClubMemberLevelConfigDto {
    const meta = CLUB_MEMBER_LEVEL_META[levelSetting.id];
    const requiredConsume = levelSetting.spendThreshold;
    const isRegisterLevel = levelSetting.id === 'gold';
    const discountText = this.formatDiscountShortText(
      levelSetting.discountRate,
    );
    const upgradeHintText = isRegisterLevel
      ? '充值即享'
      : `累计充值 ≥ ¥${this.formatAmount(requiredConsume)}`;
    const benefits = new Set<string>([
      this.formatDiscountLabel(levelSetting.discountRate),
      // 注册即享等级展示 description；有充值门槛的等级改用动态充值门槛文案
      ...(isRegisterLevel ? [levelSetting.description.trim()] : []),
      ...meta.extraBenefits,
    ]);

    if (!isRegisterLevel && requiredConsume > 0) {
      benefits.add(`累计充值 ¥${this.formatAmount(requiredConsume)} 可升级`);
    }

    return {
      level: levelSetting.id,
      label: levelSetting.name,
      color: meta.color,
      bgColor: meta.bgColor,
      requiredConsume,
      discountRate: this.normalizeRate(levelSetting.discountRate),
      discountText,
      upgradeHintText,
      benefits: Array.from(benefits).filter((benefit) => benefit.length > 0),
    };
  }

  private findCurrentLevelConfig(
    configs: ClubMemberLevelConfigDto[],
    totalConsume: number,
    fallbackLevel: ClubMemberLevelValue,
  ): ClubMemberLevelConfigDto {
    // 未产生任何充值/消费时，强制返回普通会员（无等级折扣）
    if (totalConsume <= 0) {
      return this.buildRegularLevelConfig();
    }

    const matched = [...configs]
      .reverse()
      .find((config) => totalConsume >= config.requiredConsume);

    if (matched) {
      return matched;
    }

    return (
      configs.find((config) => config.level === fallbackLevel) ?? configs[0]
    );
  }

  private buildRegularLevelConfig(): ClubMemberLevelConfigDto {
    const meta = CLUB_MEMBER_LEVEL_META.regular;
    return {
      level: 'regular',
      label: '普通会员',
      color: meta.color,
      bgColor: meta.bgColor,
      requiredConsume: 0,
      discountRate: 1,
      discountText: '--',
      upgradeHintText: '充值即享',
      benefits: ['充值即可升级享会员折扣'],
    };
  }

  private resolveVisibleFallbackLevel(
    configs: ClubMemberLevelConfigDto[],
  ): ClubMemberLevelValue {
    return configs[0]?.level ?? 'gold';
  }

  private calculateAmountToNextLevel(
    totalConsume: number,
    nextRequiredConsume: number,
  ): number {
    return Decimal.max(0, new Decimal(nextRequiredConsume).minus(totalConsume))
      .toDecimalPlaces(2)
      .toNumber();
  }

  private calculateProgressPct(
    totalConsume: number,
    currentRequiredConsume: number,
    nextRequiredConsume: number,
  ): number {
    const span = new Decimal(nextRequiredConsume).minus(currentRequiredConsume);
    if (span.lte(0)) {
      return totalConsume >= nextRequiredConsume ? 100 : 0;
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

  private normalizeRate(rate: number): number {
    return new Decimal(rate).toDecimalPlaces(2).toNumber();
  }

  private formatDiscountLabel(discountRate: number): string {
    const discount = new Decimal(discountRate).mul(10).toDecimalPlaces(1);
    const normalized = discount.isInteger()
      ? discount.toFixed(0)
      : discount.toFixed(1);
    return `${normalized}折会员专属价`;
  }

  private formatDiscountShortText(discountRate: number): string {
    const discount = new Decimal(discountRate).mul(10).toDecimalPlaces(1);
    const normalized = discount.isInteger()
      ? discount.toFixed(0)
      : discount.toFixed(1);
    return `${normalized}折`;
  }

  private formatAmount(amount: number): string {
    const decimal = new Decimal(amount).toDecimalPlaces(2);
    return decimal.isInteger() ? decimal.toFixed(0) : decimal.toFixed(2);
  }
}
