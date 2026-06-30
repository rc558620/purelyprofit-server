import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import {
  buildCacheRefreshTaskKey,
  buildMarketingOverviewCacheKey,
} from '../../redis/keys';
import { RedisService } from '../../redis/redis.service';
import { buildInviteCodeQrCodeImageUrl } from '../member/platform-membership/membership-profile.mapper';
import { Money } from '../../shared/money.utils';
import type {
  UpdateMarketingMemberLevelDto,
  UpdateMarketingPointsRatioDto,
} from './dto/marketing-query.dto';
import type {
  MarketingMemberLevelDto,
  MarketingMemberLevelSettingsDto,
  MarketingOverviewDto,
  MarketingPointsRatioDto,
} from './dto/marketing-response.dto';
import {
  buildEmptyMarketingOverview,
  buildOverviewLast30Days,
  buildOverviewMonthlyTrend,
} from './marketing.mapper';
import {
  queryOverviewDailyTrend,
  queryOverviewMonthlyTrend,
} from './marketing-overview.query';
import { MarketingSharedService } from './marketing-shared.service';
import {
  cloneDefaultMarketingMemberLevelSettings,
  getReadOnlyDefaultMarketingMemberLevelSettings,
  type MarketingMemberLevelConfigValue,
  type MarketingMemberLevelSettingsValue,
  type MarketingPointsRatioConfigValue,
} from './marketing.utils';
import {
  safeParseLevels,
  safeParsePointsRatio,
} from './schemas/member-level-settings.schema';

const MARKETING_OVERVIEW_CACHE_TTL_SECONDS = 120;
const MARKETING_OVERVIEW_REFRESH_AFTER_MS = 30_000;

type MarketingMemberLevelSettingRecord = {
  levels: Prisma.JsonValue;
  pointsRatio: Prisma.JsonValue;
};

type MarketingOverviewWechatPayRecord = {
  mchId: string | null;
  mchName: string | null;
  configuredAt: Date | null;
};

type StoreActiveInviteCodeRecord = {
  code: string;
} | null;

@Injectable()
export class MarketingOverviewService {
  private readonly logger = new Logger(MarketingOverviewService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly marketingSharedService: MarketingSharedService,
  ) {}

  async getOverview(
    user: AuthenticatedUser,
    storeId?: number,
  ): Promise<MarketingOverviewDto> {
    const resolvedStoreId =
      await this.marketingSharedService.resolveMembershipManagedStoreId(
        user,
        storeId,
      );
    if (!resolvedStoreId) {
      return buildEmptyMarketingOverview();
    }

    const cacheKey = buildMarketingOverviewCacheKey(resolvedStoreId);
    return this.redisService.getOrLoadRefreshableJson({
      cacheKey,
      taskKey: buildCacheRefreshTaskKey(cacheKey),
      ttlSeconds: MARKETING_OVERVIEW_CACHE_TTL_SECONDS,
      refreshAfterMs: MARKETING_OVERVIEW_REFRESH_AFTER_MS,
      loadValue: () => this.buildOverview(resolvedStoreId),
    });
  }

  async getMemberLevelSettings(
    user: AuthenticatedUser,
    storeId?: number,
  ): Promise<MarketingMemberLevelSettingsDto> {
    const resolvedStoreId =
      await this.marketingSharedService.resolveMembershipManagedStoreId(
        user,
        storeId,
      );
    if (!resolvedStoreId) {
      const defaults = cloneDefaultMarketingMemberLevelSettings();
      return {
        levels: defaults.levels.map((l) => this.toMemberLevelDto(l)),
        pointsRatio: this.toPointsRatioDto(defaults.pointsRatio),
        pointsFeatureEnabled: false,
      };
    }

    const [rawSettings, pointsFeatureEnabled] = await Promise.all([
      this.prisma.marketingMemberLevelSetting.findUnique({
        where: { storeId: resolvedStoreId },
        select: {
          levels: true,
          pointsRatio: true,
        },
      }),
      this.resolvePointsFeatureEnabled(resolvedStoreId),
    ]);

    const settings = this.normalizeMemberLevelSettings(rawSettings);

    return {
      levels: settings.levels.map((l) => this.toMemberLevelDto(l)),
      pointsRatio: this.toPointsRatioDto(settings.pointsRatio),
      pointsFeatureEnabled,
    };
  }

  async updateMemberLevel(
    user: AuthenticatedUser,
    levelId: string,
    dto: UpdateMarketingMemberLevelDto,
    storeId?: number,
  ): Promise<MarketingMemberLevelDto> {
    const resolvedStoreId = await this.resolveManageStoreId(user, storeId);
    const existing = await this.prisma.marketingMemberLevelSetting.findUnique({
      where: { storeId: resolvedStoreId },
      select: {
        levels: true,
        pointsRatio: true,
      },
    });
    const settings = this.normalizeMemberLevelSettings(existing);
    const now = Date.now();

    const levels = settings.levels.map((level) => {
      if (level.id !== levelId) {
        return level;
      }

      // 后端做 pct→rate 归一化，前端不参与换算
      const discountRate =
        dto.discountRatePct !== undefined
          ? Math.round(dto.discountRatePct) / 100
          : level.discountRate;
      const discountRatePct = Math.round(discountRate * 100);

      return {
        ...level,
        discountRate,
        discountRatePct,
        ...(dto.spendThreshold !== undefined && level.id !== 'gold'
          ? { spendThreshold: dto.spendThreshold }
          : {}),
        ...(dto.description !== undefined
          ? { description: dto.description.trim() }
          : {}),
        ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
        ...(level.id === 'gold' ? { spendThreshold: 0 } : {}),
        updatedAt: now,
      } satisfies MarketingMemberLevelConfigValue;
    });

    const nextSettings = {
      ...settings,
      levels,
    } satisfies MarketingMemberLevelSettingsValue;

    await this.upsertMemberLevelSettings(resolvedStoreId, nextSettings);

    const updated =
      nextSettings.levels.find((level) => level.id === levelId) ??
      nextSettings.levels[0];

    // 响应只暴露前端友好字段
    return this.toMemberLevelDto(updated);
  }

  async updatePointsRatio(
    user: AuthenticatedUser,
    dto: UpdateMarketingPointsRatioDto,
    storeId?: number,
  ): Promise<MarketingPointsRatioDto> {
    const resolvedStoreId = await this.resolveManageStoreId(user, storeId);
    const existing = await this.prisma.marketingMemberLevelSetting.findUnique({
      where: { storeId: resolvedStoreId },
      select: {
        levels: true,
        pointsRatio: true,
      },
    });
    const settings = this.normalizeMemberLevelSettings(existing);

    // 后端做 pct→rate、yuan→cents 归一化，前端不参与换算
    const earnRatioYuan =
      dto.earnRatioYuan !== undefined
        ? dto.earnRatioYuan
        : settings.pointsRatio.earnRatioYuan;
    const earnRatioCents = earnRatioYuan; // 存储字段：值与 earnRatioYuan 相同（单位均为元）

    const maxRedeemPct =
      dto.maxRedeemPct !== undefined
        ? Math.round(dto.maxRedeemPct)
        : settings.pointsRatio.maxRedeemPct;
    const maxRedeemRatio = maxRedeemPct / 100;

    const nextSettings = {
      ...settings,
      pointsRatio: {
        ...settings.pointsRatio,
        earnRatioCents,
        earnRatioYuan,
        ...(dto.redeemRatioPoints !== undefined
          ? { redeemRatioPoints: dto.redeemRatioPoints }
          : {}),
        maxRedeemRatio,
        maxRedeemPct,
        ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
        updatedAt: Date.now(),
      } satisfies MarketingPointsRatioConfigValue,
    } satisfies MarketingMemberLevelSettingsValue;

    await this.upsertMemberLevelSettings(resolvedStoreId, nextSettings);

    return this.toPointsRatioDto(nextSettings.pointsRatio);
  }

  async warmOverviewCache(storeId: number): Promise<MarketingOverviewDto> {
    const cacheKey = buildMarketingOverviewCacheKey(storeId);
    const data = await this.buildOverview(storeId);
    await this.redisService.writeRefreshableJson(
      cacheKey,
      data,
      MARKETING_OVERVIEW_CACHE_TTL_SECONDS,
      MARKETING_OVERVIEW_REFRESH_AFTER_MS,
    );
    return data;
  }

  private async buildOverview(storeId: number): Promise<MarketingOverviewDto> {
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const previousYearStart = new Date(now.getFullYear() - 1, 0, 1);

    const [
      activeMemberCount,
      balanceSum,
      totalRechargeAgg,
      todayRechargeAgg,
      thisMonthRechargeAgg,
      rechargeCount,
      dailyTotals,
      monthlyTotals,
      storeRecord,
      activeInviteCodeRecord,
    ] = await Promise.all([
      this.prisma.marketingCustomer.count({
        where: { storeId, deletedAt: null, visitCount: { gt: 0 } },
      }),
      this.prisma.marketingCustomer.aggregate({
        where: { storeId, deletedAt: null },
        _sum: { balance: true },
      }),
      this.prisma.marketingRecharge.aggregate({
        where: {
          storeId,
          type: { in: ['recharge', 'gift'] },
        },
        _sum: { totalAmount: true },
      }),
      this.prisma.marketingRecharge.aggregate({
        where: {
          storeId,
          createdAt: { gte: todayStart },
          type: { in: ['recharge', 'gift'] },
        },
        _sum: { totalAmount: true },
      }),
      this.prisma.marketingRecharge.aggregate({
        where: {
          storeId,
          createdAt: { gte: monthStart },
          type: { in: ['recharge', 'gift'] },
        },
        _sum: { totalAmount: true },
      }),
      this.prisma.marketingRecharge.count({
        where: { storeId },
      }),
      queryOverviewDailyTrend(this.prisma, storeId),
      queryOverviewMonthlyTrend(this.prisma, storeId, previousYearStart),
      this.findStoreWechatPayConfig(storeId),
      this.findStoreActiveInviteCode(storeId),
    ]);

    const totalRecharge =
      Money.fromDbCents(totalRechargeAgg._sum.totalAmount ?? 0)
        .toOutputYuan();
    const todayRecharge =
      Money.fromDbCents(todayRechargeAgg._sum.totalAmount ?? 0)
        .toOutputYuan();
    const thisMonthRecharge =
      Money.fromDbCents(thisMonthRechargeAgg._sum.totalAmount ?? 0)
        .toOutputYuan();
    const currentYear = now.getFullYear();
    const inviteCode = activeInviteCodeRecord?.code ?? null;

    const wechatConfigured = !!(
      storeRecord?.mchId && storeRecord?.configuredAt
    );

    return {
      totalBalance: Money.fromDbCents(balanceSum._sum.balance ?? 0).toOutputYuan(),
      totalRecharge,
      todayRecharge,
      thisMonthRecharge,
      rechargeCount,
      activeMemberCount,
      inviteCode,
      inviteCodeQrCodeImageUrl: inviteCode
        ? buildInviteCodeQrCodeImageUrl(inviteCode)
        : null,
      last30Days: buildOverviewLast30Days(dailyTotals),
      currentYear,
      thisYearMonthlyTrend: buildOverviewMonthlyTrend(
        monthlyTotals,
        currentYear,
      ),
      lastYearMonthlyTrend: buildOverviewMonthlyTrend(
        monthlyTotals,
        currentYear - 1,
      ),
      wechatPayConfig: {
        configured: wechatConfigured,
        ...(storeRecord?.mchId ? { mchId: storeRecord.mchId } : {}),
        ...(storeRecord?.mchName ? { mchName: storeRecord.mchName } : {}),
        ...(storeRecord?.configuredAt
          ? { configuredAt: storeRecord.configuredAt.toISOString() }
          : {}),
      },
    };
  }

  private async findStoreActiveInviteCode(
    storeId: number,
  ): Promise<StoreActiveInviteCodeRecord> {
    return this.prisma.storeInviteCode.findFirst({
      where: { storeId, isActive: true },
      select: { code: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * 从 StoreWechatPayConfig 表读取微信收款配置（Step 7: 0.5 敏感配置独立化）
   * 不再读取 Store 表的 @deprecated 字段，也不暴露 apiV3Key
   */
  private async findStoreWechatPayConfig(
    storeId: number,
  ): Promise<MarketingOverviewWechatPayRecord | null> {
    return await this.prisma.storeWechatPayConfig.findUnique({
      where: { storeId },
      select: {
        mchId: true,
        mchName: true,
        configuredAt: true,
      },
    });
  }

  private async resolveManageStoreId(
    user: AuthenticatedUser,
    storeId?: number,
  ): Promise<number> {
    const resolvedStoreId =
      await this.marketingSharedService.resolveMembershipManagedStoreId(
        user,
        storeId,
      );
    if (!resolvedStoreId) {
      throw new BadRequestException('当前账号未绑定可管理门店');
    }

    await this.marketingSharedService.ensureMarketingStoreAccess(
      user,
      resolvedStoreId,
      'marketing:manage',
    );

    return resolvedStoreId;
  }

  private async resolvePointsFeatureEnabled(storeId: number): Promise<boolean> {
    const now = new Date();
    const promotion = await this.prisma.marketingPromotion.findFirst({
      where: {
        storeId,
        type: 'points_recharge',
        enabled: true,
        startAt: { lte: now },
        endAt: { gte: now },
      },
      select: { params: true },
      orderBy: { updatedAt: 'desc' },
    });

    if (!promotion?.params || typeof promotion.params !== 'object') {
      return false;
    }

    const params = promotion.params as Record<string, unknown>;
    const rechargeRatioPercent =
      typeof params.rechargeRatioPercent === 'number'
        ? params.rechargeRatioPercent
        : typeof params.pointsRatio === 'number'
          ? params.pointsRatio
          : null;

    return rechargeRatioPercent !== null && rechargeRatioPercent > 0;
  }

  private normalizeMemberLevelSettings(
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
        const matched = parsedLevels.find(
          (item) => item.id === defaultLevel.id,
        );
        return matched
          ? {
              ...defaultLevel,
              ...matched,
              id: defaultLevel.id,
              // 兼容旧数据：若 DB 无 discountRatePct，则从 discountRate 推导
              discountRatePct:
                matched.discountRatePct ??
                Math.round((matched.discountRate ?? defaultLevel.discountRate) * 100),
            }
          : { ...defaultLevel };
      }),
      pointsRatio: this.normalizePointsRatio(
        settings.pointsRatio,
        fallback.pointsRatio,
      ),
    };
  }

  private normalizeMemberLevel(
    raw: Record<string, unknown> | undefined,
    fallback: MarketingMemberLevelConfigValue,
  ): MarketingMemberLevelConfigValue {
    const discountRate =
      typeof raw?.discountRate === 'number'
        ? raw.discountRate
        : fallback.discountRate;
    const discountRatePct =
      typeof raw?.discountRatePct === 'number'
        ? raw.discountRatePct
        : Math.round(discountRate * 100);

    return {
      id: fallback.id,
      name: typeof raw?.name === 'string' ? raw.name : fallback.name,
      discountRate,
      discountRatePct,
      spendThreshold:
        typeof raw?.spendThreshold === 'number'
          ? Math.max(0, Math.round(raw.spendThreshold))
          : fallback.spendThreshold,
      description:
        typeof raw?.description === 'string'
          ? raw.description
          : fallback.description,
      enabled:
        typeof raw?.enabled === 'boolean' ? raw.enabled : fallback.enabled,
      updatedAt:
        typeof raw?.updatedAt === 'number' ? raw.updatedAt : fallback.updatedAt,
    };
  }

  private normalizePointsRatio(
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
        maxRedeemPct: parsed.maxRedeemPct ?? Math.round(parsed.maxRedeemRatio * 100),
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
  private toMemberLevelDto(
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
  private toPointsRatioDto(
    ratio: MarketingPointsRatioConfigValue,
  ): MarketingPointsRatioDto {
    return {
      earnRatioYuan: ratio.earnRatioYuan,
      redeemRatioPoints: ratio.redeemRatioPoints,
      maxRedeemPct: ratio.maxRedeemPct,
      enabled: ratio.enabled,
      updatedAt: ratio.updatedAt,
      // 内部存储字段保留，用于 DB 读写兼容
      earnRatioCents: ratio.earnRatioCents,
      maxRedeemRatio: ratio.maxRedeemRatio,
    };
  }

  private async upsertMemberLevelSettings(
    storeId: number,
    settings: MarketingMemberLevelSettingsValue,
  ): Promise<void> {
    await this.prisma.marketingMemberLevelSetting.upsert({
      where: { storeId },
      create: {
        storeId,
        levels: settings.levels as unknown as Prisma.InputJsonValue,
        pointsRatio: settings.pointsRatio as unknown as Prisma.InputJsonValue,
      },
      update: {
        levels: settings.levels as unknown as Prisma.InputJsonValue,
        pointsRatio: settings.pointsRatio as unknown as Prisma.InputJsonValue,
      },
    });
  }
}
