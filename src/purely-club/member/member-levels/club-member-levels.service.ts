import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  cloneDefaultMarketingMemberLevelSettings,
  type MarketingMemberLevelConfigValue,
} from '../../../purely-profit/marketing/marketing.utils';
import type {
  ClubMemberLevelConfigDto,
  ClubMemberLevelStatusDto,
  ClubMemberLevelValue,
} from '../dto/club-member-account.dto';
import type { ClubMemberSnapshot } from '../member-profile/club-member-profile.service';
import {
  ClubLevelSettingsTtlCache,
  cloneLevelSettings,
} from './club-member-levels.cache';
import {
  CLUB_MEMBER_HELD_LEVEL_LABEL_MAP,
  CLUB_MEMBER_LEVEL_META,
  calculateAmountToNextLevel,
  calculateProgressPct,
  formatAmount,
  formatDiscountLabel,
  formatDiscountShortText,
  normalizeMemberLevels,
  normalizeRate,
  type ClubMemberLevelResolution,
} from './club-member-levels.shared';

export type { ClubMemberLevelResolution };

@Injectable()
export class ClubMemberLevelsService {
  constructor(private readonly prisma: PrismaService) {}

  async listConfigs(storeId: number): Promise<ClubMemberLevelConfigDto[]> {
    const levelSettings = await this.loadLevelSettings(storeId);
    return this.listConfigsFromSettings(levelSettings);
  }

  /**
   * 用**已解析**的原始等级配置生成可见等级列表。
   *
   * 与 `listConfigs` 共用 `toActiveConfigDtos`，保证「首页等级列表」与
   * 「账户里的可见等级列表」永远同一口径；区别只在于配置来源（自行读取 vs 调用方种子）。
   */
  listConfigsFromSettings(
    levelSettings: MarketingMemberLevelConfigValue[],
  ): ClubMemberLevelConfigDto[] {
    return this.toActiveConfigDtos(levelSettings);
  }

  async resolveCurrentLevel(
    snapshot: ClubMemberSnapshot,
  ): Promise<ClubMemberLevelValue> {
    const resolution = await this.resolveLevelResolution(snapshot);
    return resolution.currentLevelConfig.level;
  }

  /**
   * @param levelSettings 请求级种子（原始配置，含已停用等级）。
   *   传入时直接复用，跳过配置表读取；不传时行为与历史一致（自行读取）。
   */
  async resolveCurrentLevelConfig(
    snapshot: ClubMemberSnapshot,
    levelSettings?: MarketingMemberLevelConfigValue[],
  ): Promise<ClubMemberLevelConfigDto> {
    const resolution = await this.resolveLevelResolution(
      snapshot,
      levelSettings,
    );
    return resolution.currentLevelConfig;
  }

  /**
   * @param levelSettings 请求级种子（原始配置，含已停用等级）。
   *   传入时不再读配置表；`heldLevelConfig` 仍从**原始配置**取，所以
   *   「已停用但顾客仍持有」的等级不会丢 label。
   */
  async resolveLevelResolution(
    snapshot: ClubMemberSnapshot,
    levelSettings?: MarketingMemberLevelConfigValue[],
  ): Promise<ClubMemberLevelResolution> {
    const resolvedLevelSettings =
      levelSettings ?? (await this.loadLevelSettings(snapshot.storeId));
    const visibleLevelConfigs = this.toActiveConfigDtos(resolvedLevelSettings);
    const allLevelConfigs = resolvedLevelSettings.map((levelSetting) =>
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
    // 当前等级不在可展示列表中：典型场景是未充值用户的 regular 兜底等级 ——
    // 它只作为「未产生消费时的计算态」存在，并不在后台配置的可见等级里，
    // 因此 findIndex 必然返回 -1。此时下一级应取最低可见等级，
    // 不能因为查不到索引就判定为「已达最高等级」，否则未充值用户会彻底丢失升级引导。
    const nextLevelConfig =
      currentIndex >= 0
        ? (configs[currentIndex + 1] ?? null)
        : (configs[0] ?? null);

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

  /**
   * 并发去重：同一门店的在途请求共用一个 Promise。
   * 会员等级页会并发请求 account / level-status / levels，三个接口都要读同一份配置，
   * 去重后一次页面加载只查一次配置表。
   *
   * 与下面的 TTL 缓存叠加后的语义：3s 内直接命中缓存；缓存未命中瞬间的并发请求
   * 由本 Map 合并成一次回源。
   */
  private readonly inflightSettingsRequests = new Map<
    number,
    Promise<MarketingMemberLevelConfigValue[]>
  >();

  /**
   * 等级配置进程内 TTL 缓存（3-B-2）。
   *
   * 只缓存 `levels`：同一行的 `pointsRatio` 是资金口径（积分抵扣 / 赠送比例），
   * 必须每次直读，禁止并入此缓存。
   */
  private readonly levelSettingsCache = new ClubLevelSettingsTtlCache();

  /**
   * 读取门店原始等级配置（含已停用等级）。
   *
   * 对外暴露是为了支撑「请求级种子」：首页一次 `getHome` 内三条分支
   * （等级列表 / 账户等级 / 商品定价）都需要同一份配置，由调用方解析一次后
   * 透传，避免各自回源。
   *
   * 可见延迟：命中进程内缓存时可能读到最多 3s 前的配置（见
   * `CLUB_LEVEL_SETTINGS_CACHE_TTL_MS`）。返回值为副本，调用方可安全修改。
   */
  async loadLevelSettings(
    storeId: number,
  ): Promise<MarketingMemberLevelConfigValue[]> {
    const cached = this.levelSettingsCache.get(storeId);
    if (cached) {
      return cloneLevelSettings(cached);
    }

    const inflight = this.inflightSettingsRequests.get(storeId);
    if (inflight) {
      return cloneLevelSettings(await inflight);
    }

    const request = this.fetchLevelSettings(storeId).finally(() => {
      this.inflightSettingsRequests.delete(storeId);
    });
    this.inflightSettingsRequests.set(storeId, request);

    return cloneLevelSettings(await request);
  }

  /**
   * 回源读取并写入缓存。
   *
   * 失败（数据库异常）不写缓存，下次请求会重新尝试——缓存只做加速，
   * 不允许把一次失败固化成 3s 的错误结果。
   */
  private async fetchLevelSettings(
    storeId: number,
  ): Promise<MarketingMemberLevelConfigValue[]> {
    const fallback = cloneDefaultMarketingMemberLevelSettings();
    const settings = await this.prisma.marketingMemberLevelSetting.findUnique({
      where: { storeId },
      select: {
        levels: true,
      },
    });

    const levels = normalizeMemberLevels(settings, fallback.levels);
    this.levelSettingsCache.set(storeId, levels);
    return levels;
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
