import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import {
  buildCacheRefreshTaskKey,
  buildMarketingOverviewCacheKey,
} from '../../redis/keys';
import { RedisService } from '../../redis/redis.service';
import {
  buildStoreInviteCode,
  buildStoreInviteQrCodeImageUrl,
} from '../member/platform-membership/membership-profile.mapper';
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
import { MarketingSharedService } from './marketing-shared.service';
import {
  cloneDefaultMarketingMemberLevelSettings,
  type MarketingMemberLevelConfigValue,
  type MarketingMemberLevelIdValue,
  type MarketingMemberLevelSettingsValue,
  type MarketingPointsRatioConfigValue,
} from './marketing.utils';

const MARKETING_OVERVIEW_CACHE_TTL_SECONDS = 120;
const MARKETING_OVERVIEW_REFRESH_AFTER_MS = 30_000;

type MarketingMemberLevelSettingRecord = {
  levels: Prisma.JsonValue;
  pointsRatio: Prisma.JsonValue;
};

@Injectable()
export class MarketingOverviewService {
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
      return cloneDefaultMarketingMemberLevelSettings();
    }

    const settings = await this.prisma.marketingMemberLevelSetting.findUnique({
      where: { storeId: resolvedStoreId },
      select: {
        levels: true,
        pointsRatio: true,
      },
    });

    return this.normalizeMemberLevelSettings(settings);
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

      return {
        ...level,
        ...(dto.discountRate !== undefined
          ? { discountRate: dto.discountRate }
          : {}),
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

    return (
      nextSettings.levels.find((level) => level.id === levelId) ??
      nextSettings.levels[0]
    );
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

    const nextSettings = {
      ...settings,
      pointsRatio: {
        ...settings.pointsRatio,
        ...(dto.earnRatioCents !== undefined
          ? { earnRatioCents: dto.earnRatioCents }
          : {}),
        ...(dto.redeemRatioPoints !== undefined
          ? { redeemRatioPoints: dto.redeemRatioPoints }
          : {}),
        ...(dto.maxRedeemRatio !== undefined
          ? { maxRedeemRatio: dto.maxRedeemRatio }
          : {}),
        ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
        updatedAt: Date.now(),
      } satisfies MarketingPointsRatioConfigValue,
    } satisfies MarketingMemberLevelSettingsValue;

    await this.upsertMemberLevelSettings(resolvedStoreId, nextSettings);

    return nextSettings.pointsRatio;
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
      trendRechargeRows,
    ] = await Promise.all([
      this.prisma.marketingCustomer.count({
        where: { storeId, visitCount: { gt: 0 } },
      }),
      this.prisma.marketingCustomer.aggregate({
        where: { storeId },
        _sum: { balance: true },
      }),
      this.prisma.marketingRecharge.aggregate({
        where: {
          storeId,
          type: { in: ['recharge', 'gift'] },
        },
        _sum: { amount: true, giftAmount: true },
      }),
      this.prisma.marketingRecharge.aggregate({
        where: {
          storeId,
          createdAt: { gte: todayStart },
          type: { in: ['recharge', 'gift'] },
        },
        _sum: { amount: true, giftAmount: true },
      }),
      this.prisma.marketingRecharge.aggregate({
        where: {
          storeId,
          createdAt: { gte: monthStart },
          type: { in: ['recharge', 'gift'] },
        },
        _sum: { amount: true, giftAmount: true },
      }),
      this.prisma.marketingRecharge.count({
        where: { storeId },
      }),
      this.prisma.marketingRecharge.findMany({
        where: {
          storeId,
          createdAt: { gte: previousYearStart },
          type: { in: ['recharge', 'gift'] },
        },
        select: { createdAt: true, amount: true, giftAmount: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    const totalRecharge =
      (totalRechargeAgg._sum.amount ?? 0) +
      (totalRechargeAgg._sum.giftAmount ?? 0);
    const todayRecharge =
      (todayRechargeAgg._sum.amount ?? 0) +
      (todayRechargeAgg._sum.giftAmount ?? 0);
    const thisMonthRecharge =
      (thisMonthRechargeAgg._sum.amount ?? 0) +
      (thisMonthRechargeAgg._sum.giftAmount ?? 0);
    const currentYear = now.getFullYear();
    const inviteCode = buildStoreInviteCode(storeId);

    return {
      totalBalance: balanceSum._sum.balance ?? 0,
      totalRecharge,
      todayRecharge,
      thisMonthRecharge,
      rechargeCount,
      activeMemberCount,
      inviteCode,
      inviteCodeQrCodeImageUrl: buildStoreInviteQrCodeImageUrl(storeId),
      last30Days: buildOverviewLast30Days(trendRechargeRows),
      currentYear,
      thisYearMonthlyTrend: buildOverviewMonthlyTrend(
        trendRechargeRows,
        currentYear,
      ),
      lastYearMonthlyTrend: buildOverviewMonthlyTrend(
        trendRechargeRows,
        currentYear - 1,
      ),
    };
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

  private normalizeMemberLevelSettings(
    settings: MarketingMemberLevelSettingRecord | null,
  ): MarketingMemberLevelSettingsDto {
    const fallback = cloneDefaultMarketingMemberLevelSettings();
    if (!settings) {
      return fallback;
    }

    const rawLevels = Array.isArray(settings.levels) ? settings.levels : [];
    return {
      levels: fallback.levels.map((defaultLevel) => {
        const found = rawLevels.find(
          (item) =>
            !!item &&
            typeof item === 'object' &&
            !Array.isArray(item) &&
            (item as Record<string, unknown>).id === defaultLevel.id,
        );
        const matched =
          found != null && typeof found === 'object' && !Array.isArray(found)
            ? (found as Record<string, unknown>)
            : undefined;
        return this.normalizeMemberLevel(matched, defaultLevel);
      }),
      pointsRatio: this.normalizePointsRatio(settings.pointsRatio, fallback.pointsRatio),
    };
  }

  private normalizeMemberLevel(
    raw: Record<string, unknown> | undefined,
    fallback: MarketingMemberLevelConfigValue,
  ): MarketingMemberLevelConfigValue {
    return {
      id: fallback.id,
      name: typeof raw?.name === 'string' ? raw.name : fallback.name,
      discountRate:
        typeof raw?.discountRate === 'number'
          ? raw.discountRate
          : fallback.discountRate,
      spendThreshold:
        typeof raw?.spendThreshold === 'number'
          ? Math.max(0, Math.round(raw.spendThreshold))
          : fallback.spendThreshold,
      description:
        typeof raw?.description === 'string'
          ? raw.description
          : fallback.description,
      enabled: typeof raw?.enabled === 'boolean' ? raw.enabled : fallback.enabled,
      updatedAt:
        typeof raw?.updatedAt === 'number' ? raw.updatedAt : fallback.updatedAt,
    };
  }

  private normalizePointsRatio(
    raw: Prisma.JsonValue,
    fallback: MarketingPointsRatioConfigValue,
  ): MarketingPointsRatioDto {
    const normalized =
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? raw
        : ({} as Record<string, unknown>);

    return {
      earnRatioCents:
        typeof normalized.earnRatioCents === 'number'
          ? Math.max(1, Math.round(normalized.earnRatioCents))
          : fallback.earnRatioCents,
      redeemRatioPoints:
        typeof normalized.redeemRatioPoints === 'number'
          ? Math.max(1, Math.round(normalized.redeemRatioPoints))
          : fallback.redeemRatioPoints,
      maxRedeemRatio:
        typeof normalized.maxRedeemRatio === 'number'
          ? normalized.maxRedeemRatio
          : fallback.maxRedeemRatio,
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

  private async upsertMemberLevelSettings(
    storeId: number,
    settings: MarketingMemberLevelSettingsValue,
  ): Promise<void> {
    await this.prisma.marketingMemberLevelSetting.upsert({
      where: { storeId },
      create: {
        storeId,
        levels: settings.levels.map((level) => ({ ...level })) as Prisma.InputJsonValue,
        pointsRatio: { ...settings.pointsRatio } as Prisma.InputJsonValue,
      },
      update: {
        levels: settings.levels.map((level) => ({ ...level })) as Prisma.InputJsonValue,
        pointsRatio: { ...settings.pointsRatio } as Prisma.InputJsonValue,
      },
    });
  }
}
