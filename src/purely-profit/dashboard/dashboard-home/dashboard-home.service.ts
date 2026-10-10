import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { STORE_SUB_ACCOUNT_ROLE_LABELS } from '../../access-control/access-control.constants';
import { SubjectCapabilityService } from '../../access-control/subject-capability.service';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { NewCustomerQuotaService } from '../../member/new-customer-quota/new-customer-quota.service';
import { StoreSubAccountService } from '../../member/platform-membership/store-sub-account.service';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  buildCacheRefreshTaskKey,
  buildProfitDashboardHomeActivitiesCacheKey,
  buildProfitDashboardHomeCacheKey,
  buildProfitDashboardHomeStatsCacheKey,
  buildProfitDashboardHomeTrendCacheKey,
} from '../../../redis/keys';
import { RefreshableCacheService } from '../../../redis/refreshable-cache.service';
import { RedisService } from '../../../redis/redis.service';
import type { GetDashboardHomeOverviewQueryDto } from './dto/dashboard-home-query.dto';
import type {
  DashboardHomeOverviewResponseDto,
  DashboardHomeQuotaDto,
  DashboardHomeSalesTrendDto,
} from './dto/dashboard-home-response.dto';
import {
  buildDashboardHomeOverviewResponse,
  type DashboardHomeOverviewWithoutCapability,
} from './dashboard-home.mapper';
import {
  loadDashboardHomeActivitiesData,
  loadDashboardHomeStatsData,
  loadDashboardHomeTrendRows,
} from './dashboard-home.query';
import {
  buildCompareRange,
  buildCurrentRange,
  buildDashboardHomeQueryInput,
  buildDashboardHomeSalesTrend,
} from './dashboard-home.utils';
import type {
  DashboardHomeActivitiesData,
  DashboardHomePeriodValue,
  DashboardHomeStatsData,
  TimeRange,
} from './dashboard-home.types';

const PROFIT_DASHBOARD_HOME_CACHE_TTL_SECONDS = 30;
const PROFIT_DASHBOARD_HOME_STATS_REFRESH_AFTER_MS = 10_000;
const PROFIT_DASHBOARD_HOME_TREND_CACHE_TTL_SECONDS = 60;
const PROFIT_DASHBOARD_HOME_TREND_REFRESH_AFTER_MS = 20_000;
const PROFIT_DASHBOARD_HOME_ACTIVITIES_CACHE_TTL_SECONDS = 45;
const PROFIT_DASHBOARD_HOME_ACTIVITIES_REFRESH_AFTER_MS = 15_000;

@Injectable()
export class DashboardHomeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly refreshableCache: RefreshableCacheService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly subjectCapabilityService: SubjectCapabilityService,
    private readonly storeSubAccountService: StoreSubAccountService,
    private readonly quotaService: NewCustomerQuotaService,
  ) {}

  async getOverview(
    user: AuthenticatedUser,
    queryDto: GetDashboardHomeOverviewQueryDto,
  ): Promise<DashboardHomeOverviewResponseDto> {
    const query = buildDashboardHomeQueryInput(queryDto);
    const period = query.period ?? 'today';
    const preliminaryStoreId =
      user.currentMembership?.storeId ?? query.storeId ?? 0;
    // 权限裁决只依赖身份维度，先按登录态自带的门店 ID 取一次能力快照。
    const preliminaryCapability = await this.buildCapabilitySnapshot(
      user,
      preliminaryStoreId,
    );
    const requiredPermission = preliminaryCapability.canAccessDashboardOverview
      ? 'operation-entry:view'
      : 'report:view';
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      query.storeId,
      requiredPermission,
      '无权查看该门店首页概览',
    );
    // 真实门店 ID 与预估不一致时按真实值重算：否则会用 storeId=0 算出空能力，
    // 导致业态能力（餐饮/空间/扫码点单）被错误降级为 false。
    const capabilitySnapshot =
      storeId === preliminaryStoreId
        ? preliminaryCapability
        : await this.buildCapabilitySnapshot(user, storeId);

    const cacheKey = buildProfitDashboardHomeCacheKey(storeId, period);
    // 概览主体（不含 capability）按门店+周期整包缓存，命中即直接返回。
    // capability 与登录用户相关，必须实时计算，不能进缓存。
    const cachedOverview =
      await this.redisService.getJson<DashboardHomeOverviewWithoutCapability>(
        cacheKey,
      );
    if (cachedOverview) {
      return { ...cachedOverview, capability: capabilitySnapshot };
    }

    const currentRange = buildCurrentRange(period);
    const compareRange = buildCompareRange(period, currentRange);
    const now = Date.now();
    const [statsData, salesTrend, activitiesData, quotaOverview] =
      await Promise.all([
        this.loadStatsCache(storeId, period, currentRange, compareRange),
        this.loadTrendCache(storeId, period, currentRange),
        this.loadActivitiesCache(storeId, now),
        this.quotaService.getOverview(storeId),
      ]);
    const overview = this.buildOverviewResponse(
      period,
      storeId,
      currentRange,
      compareRange,
      now,
      statsData,
      salesTrend,
      activitiesData,
      this.toQuotaDto(quotaOverview),
    );

    await this.redisService.setJson(
      cacheKey,
      overview,
      PROFIT_DASHBOARD_HOME_CACHE_TTL_SECONDS,
    );

    return {
      ...overview,
      capability: capabilitySnapshot,
    };
  }

  private toQuotaDto(quotaOverview: {
    remaining: number;
    warningThreshold: number;
    totalRecharged: number;
    totalGranted: number;
    totalConsumed: number;
  }): DashboardHomeQuotaDto {
    return {
      remaining: quotaOverview.remaining,
      warningThreshold: quotaOverview.warningThreshold,
      totalRecharged: quotaOverview.totalRecharged,
      totalGranted: quotaOverview.totalGranted,
      totalConsumed: quotaOverview.totalConsumed,
    };
  }

  async warmOverviewCache(
    storeId: number,
    period: NonNullable<GetDashboardHomeOverviewQueryDto['period']> | 'today',
  ): Promise<DashboardHomeOverviewWithoutCapability> {
    const cacheKey = buildProfitDashboardHomeCacheKey(storeId, period);
    const currentRange = buildCurrentRange(period);
    const compareRange = buildCompareRange(period, currentRange);
    const now = Date.now();
    const [statsData, salesTrend, activitiesData, quotaOverview] =
      await Promise.all([
        this.refreshStatsCache(storeId, period, currentRange, compareRange),
        this.refreshTrendCache(storeId, period, currentRange),
        this.refreshActivitiesCache(storeId, now),
        this.quotaService.getOverview(storeId),
      ]);
    const response = this.buildOverviewResponse(
      period,
      storeId,
      currentRange,
      compareRange,
      now,
      statsData,
      salesTrend,
      activitiesData,
      this.toQuotaDto(quotaOverview),
    );

    await this.redisService.setJson(
      cacheKey,
      response,
      PROFIT_DASHBOARD_HOME_CACHE_TTL_SECONDS,
    );

    return response;
  }

  private async loadStatsCache(
    storeId: number,
    period: DashboardHomePeriodValue,
    currentRange: TimeRange,
    compareRange: TimeRange,
  ): Promise<DashboardHomeStatsData> {
    const cacheKey = buildProfitDashboardHomeStatsCacheKey(storeId, period);
    return this.refreshableCache.getOrLoadRefreshableJson({
      cacheKey,
      taskKey: buildCacheRefreshTaskKey(cacheKey),
      ttlSeconds: PROFIT_DASHBOARD_HOME_CACHE_TTL_SECONDS,
      refreshAfterMs: PROFIT_DASHBOARD_HOME_STATS_REFRESH_AFTER_MS,
      loadValue: () =>
        loadDashboardHomeStatsData(this.prisma, {
          storeId,
          currentRange,
          compareRange,
        }),
    });
  }

  private async refreshStatsCache(
    storeId: number,
    period: DashboardHomePeriodValue,
    currentRange: TimeRange,
    compareRange: TimeRange,
  ): Promise<DashboardHomeStatsData> {
    const cacheKey = buildProfitDashboardHomeStatsCacheKey(storeId, period);
    const data = await loadDashboardHomeStatsData(this.prisma, {
      storeId,
      currentRange,
      compareRange,
    });
    await this.refreshableCache.writeRefreshableJson(
      cacheKey,
      data,
      PROFIT_DASHBOARD_HOME_CACHE_TTL_SECONDS,
      PROFIT_DASHBOARD_HOME_STATS_REFRESH_AFTER_MS,
    );
    return data;
  }

  private async loadTrendCache(
    storeId: number,
    period: DashboardHomePeriodValue,
    currentRange: TimeRange,
  ): Promise<DashboardHomeSalesTrendDto> {
    const cacheKey = buildProfitDashboardHomeTrendCacheKey(storeId, period);
    return this.refreshableCache.getOrLoadRefreshableJson({
      cacheKey,
      taskKey: buildCacheRefreshTaskKey(cacheKey),
      ttlSeconds: PROFIT_DASHBOARD_HOME_TREND_CACHE_TTL_SECONDS,
      refreshAfterMs: PROFIT_DASHBOARD_HOME_TREND_REFRESH_AFTER_MS,
      loadValue: async () => {
        const trendRows = await loadDashboardHomeTrendRows(this.prisma, {
          storeId,
          period,
          currentRange,
        });
        return buildDashboardHomeSalesTrend(period, currentRange, trendRows);
      },
    });
  }

  private async refreshTrendCache(
    storeId: number,
    period: DashboardHomePeriodValue,
    currentRange: TimeRange,
  ): Promise<DashboardHomeSalesTrendDto> {
    const cacheKey = buildProfitDashboardHomeTrendCacheKey(storeId, period);
    const trendRows = await loadDashboardHomeTrendRows(this.prisma, {
      storeId,
      period,
      currentRange,
    });
    const data = buildDashboardHomeSalesTrend(period, currentRange, trendRows);
    await this.refreshableCache.writeRefreshableJson(
      cacheKey,
      data,
      PROFIT_DASHBOARD_HOME_TREND_CACHE_TTL_SECONDS,
      PROFIT_DASHBOARD_HOME_TREND_REFRESH_AFTER_MS,
    );
    return data;
  }

  /**
   * 动态数据只与门店和当前时间有关（与 period 无关），缓存键不带 period，
   * 否则同一份数据会被复制 5 份并回源 5 次。
   */
  private async loadActivitiesCache(
    storeId: number,
    now: number,
  ): Promise<DashboardHomeActivitiesData> {
    const cacheKey = buildProfitDashboardHomeActivitiesCacheKey(storeId);
    return this.refreshableCache.getOrLoadRefreshableJson({
      cacheKey,
      taskKey: buildCacheRefreshTaskKey(cacheKey),
      ttlSeconds: PROFIT_DASHBOARD_HOME_ACTIVITIES_CACHE_TTL_SECONDS,
      refreshAfterMs: PROFIT_DASHBOARD_HOME_ACTIVITIES_REFRESH_AFTER_MS,
      loadValue: () =>
        loadDashboardHomeActivitiesData(this.prisma, { storeId, now }),
    });
  }

  private async refreshActivitiesCache(
    storeId: number,
    now: number,
  ): Promise<DashboardHomeActivitiesData> {
    const cacheKey = buildProfitDashboardHomeActivitiesCacheKey(storeId);
    const data = await loadDashboardHomeActivitiesData(this.prisma, {
      storeId,
      now,
    });
    await this.refreshableCache.writeRefreshableJson(
      cacheKey,
      data,
      PROFIT_DASHBOARD_HOME_ACTIVITIES_CACHE_TTL_SECONDS,
      PROFIT_DASHBOARD_HOME_ACTIVITIES_REFRESH_AFTER_MS,
    );
    return data;
  }

  private buildOverviewResponse(
    period: DashboardHomePeriodValue,
    storeId: number,
    currentRange: TimeRange,
    compareRange: TimeRange,
    now: number,
    statsData: DashboardHomeStatsData,
    salesTrend: DashboardHomeSalesTrendDto,
    activitiesData: DashboardHomeActivitiesData,
    quota: DashboardHomeQuotaDto,
  ): DashboardHomeOverviewWithoutCapability {
    return buildDashboardHomeOverviewResponse({
      period,
      storeId,
      currentRange,
      compareRange,
      now,
      statsData,
      salesTrend,
      activitiesData,
      quota,
    });
  }

  private async buildCapabilitySnapshot(
    user: AuthenticatedUser,
    storeId: number,
  ) {
    const subAccountSummary =
      await this.storeSubAccountService.getStoreSubAccountSummary(storeId);
    const snapshot = this.subjectCapabilityService.buildSnapshot(
      user.currentMembership,
      subAccountSummary.quota,
    );

    // 业态能力：从数据库读取门店 businessMode
    const businessMode = await this.resolveStoreBusinessMode(storeId);
    const isCatering = businessMode === 'catering';
    const isBusinessModeKnown = businessMode !== null;

    return {
      identityType: snapshot.identityType,
      subAccountRole: snapshot.subAccountRole ?? undefined,
      subAccountRoleLabel: snapshot.subAccountRole
        ? STORE_SUB_ACCOUNT_ROLE_LABELS[snapshot.subAccountRole]
        : undefined,
      allowedHomeModules: snapshot.allowedHomeModules,
      hiddenHomeModules: snapshot.hiddenHomeModules,
      canViewFinance: snapshot.canViewFinance,
      canViewMarketing: snapshot.canViewMarketing,
      canUseGoodsManagement: snapshot.canUseGoodsManagement,
      ...(user.currentMembership?.subAccountStatus
        ? { subAccountStatus: user.currentMembership.subAccountStatus }
        : {}),
      ...(user.currentMembership?.subAccountAssigned !== undefined
        ? { subAccountAssigned: user.currentMembership.subAccountAssigned }
        : {}),
      ...(user.currentMembership?.canAccessHome !== undefined
        ? { canAccessHome: user.currentMembership.canAccessHome }
        : {}),
      ...(user.currentMembership?.canUseHandover !== undefined
        ? { canUseHandover: user.currentMembership.canUseHandover }
        : {}),
      canUseHandoverManagement: snapshot.canUseHandoverManagement,
      canUseSpaceManagement: isBusinessModeKnown
        ? snapshot.canUseSpaceManagement && !isCatering
        : false,
      canAccessStoreSettings: snapshot.canAccessStoreSettings,
      canAccessDashboardOverview:
        snapshot.allowedHomeModules.includes('additional') &&
        user.currentMembership?.canAccessHome !== false,
      // ─── 业态能力 ───
      businessMode: businessMode ?? 'general',
      isCateringStore: isCatering,
      isGeneralStore: isBusinessModeKnown && !isCatering,
      canUseScanOrdering: isCatering,
      canManageScanOrderingMenu: isCatering,
      canUseMarketingProductListing: isBusinessModeKnown && !isCatering,
    };
  }

  private async resolveStoreBusinessMode(
    storeId: number,
  ): Promise<'catering' | 'general' | null> {
    try {
      const store = await this.prisma.store.findUnique({
        where: { id: storeId },
        select: { businessMode: true },
      });
      if (!store) {
        return null;
      }
      return store.businessMode;
    } catch {
      return null;
    }
  }
}
