import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  cloneDefaultMarketingMemberLevelSettings,
  type MarketingMemberLevelConfigValue,
} from '../../../purely-profit/marketing/marketing.utils';
import { safeParseLevels } from '../../../purely-profit/marketing/schemas/member-level-settings.schema';
import type {
  ClubMemberLevelConfigDto,
  ClubMemberLevelStatusDto,
  ClubMemberLevelValue,
} from '../dto/club-member-account.dto';
import type { ClubMemberSnapshot } from '../member-profile/club-member-profile.service';
import {
  CLUB_MEMBER_HELD_LEVEL_LABEL_MAP,
  CLUB_MEMBER_LEVEL_META,
  calculateAmountToNextLevel,
  calculateProgressPct,
  formatAmount,
  formatDiscountLabel,
  formatDiscountShortText,
  normalizeRate,
  type ClubMemberLevelResolution,
  type ClubMemberLevelSettingRecord,
} from './club-member-levels.shared';

export type { ClubMemberLevelResolution };

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
      amountToNextLevel: calculateAmountToNextLevel(
        snapshot.totalConsume,
        nextLevelConfig.requiredConsume,
      ),
      progressPct: calculateProgressPct(
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
    const discountText = formatDiscountShortText(levelSetting.discountRate);
    const upgradeHintText = isRegisterLevel
      ? '充值即享'
      : `累计充值 ≥ ¥${formatAmount(requiredConsume)}`;
    const benefits = new Set<string>([
      formatDiscountLabel(levelSetting.discountRate),
      // 充值即享等级展示 description；有充值门槛的等级改用动态充值门槛文案
      ...(isRegisterLevel ? [levelSetting.description.trim()] : []),
      ...meta.extraBenefits,
    ]);

    if (!isRegisterLevel && requiredConsume > 0) {
      benefits.add(`累计充值 ¥${formatAmount(requiredConsume)} 可升级`);
    }

    return {
      level: levelSetting.id,
      label: levelSetting.name,
      color: meta.color,
      bgColor: meta.bgColor,
      requiredConsume,
      discountRate: normalizeRate(levelSetting.discountRate),
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
}
