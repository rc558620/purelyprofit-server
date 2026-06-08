import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { STORE_SUB_ACCOUNT_ROLE_LABELS } from '../../access-control/access-control.constants';
import { SubjectCapabilityService } from '../../access-control/subject-capability.service';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { StoreSubAccountService } from '../../member/platform-membership/store-sub-account.service';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  buildCacheRefreshTaskKey,
  buildProfitDashboardHomeActivitiesCacheKey,
  buildProfitDashboardHomeCacheKey,
  buildProfitDashboardHomeStatsCacheKey,
  buildProfitDashboardHomeTrendCacheKey,
} from '../../../redis/keys';
import { RedisService } from '../../../redis/redis.service';
import type { GetDashboardHomeOverviewQueryDto } from './dto/dashboard-home-query.dto';
import type {
  DashboardHomeOverviewResponseDto,
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
    private readonly commerceAccessService: CommerceAccessService,
    private readonly subjectCapabilityService: SubjectCapabilityService,
    private readonly storeSubAccountService: StoreSubAccountService,
  ) {}

  async getOverview(
    user: AuthenticatedUser,
    queryDto: GetDashboardHomeOverviewQueryDto,
  ): Promise<DashboardHomeOverviewResponseDto> {
    const query = buildDashboardHomeQueryInput(queryDto);
    const period = query.period ?? 'today';
    const capabilitySnapshot = await this.buildCapabilitySnapshot(
      user,
      user.currentMembership?.storeId ?? query.storeId ?? 0,
    );
    const requiredPermission = capabilitySnapshot.canAccessDashboardOverview
      ? 'operation-entry:view'
      : 'report:view';
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      query.storeId,
      requiredPermission,
      '无权查看该门店首页概览',
    );
    const currentRange = buildCurrentRange(period);
    const compareRange = buildCompareRange(period, currentRange);
    const now = Date.now();
    const [statsData, salesTrend, activitiesData] = await Promise.all([
      this.loadStatsCache(storeId, period, currentRange, compareRange),
      this.loadTrendCache(storeId, period, currentRange),
      this.loadActivitiesCache(storeId, period, now),
    ]);

    return {
      ...this.buildOverviewResponse(
        period,
        storeId,
        currentRange,
        compareRange,
        now,
        statsData,
        salesTrend,
        activitiesData,
      ),
      capability: capabilitySnapshot,
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
    const [statsData, salesTrend, activitiesData] = await Promise.all([
      this.refreshStatsCache(storeId, period, currentRange, compareRange),
      this.refreshTrendCache(storeId, period, currentRange),
      this.refreshActivitiesCache(storeId, period, now),
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
    return this.redisService.getOrLoadRefreshableJson({
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
    await this.redisService.writeRefreshableJson(
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
    return this.redisService.getOrLoadRefreshableJson({
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
    await this.redisService.writeRefreshableJson(
      cacheKey,
      data,
      PROFIT_DASHBOARD_HOME_TREND_CACHE_TTL_SECONDS,
      PROFIT_DASHBOARD_HOME_TREND_REFRESH_AFTER_MS,
    );
    return data;
  }

  private async loadActivitiesCache(
    storeId: number,
    period: DashboardHomePeriodValue,
    now: number,
  ): Promise<DashboardHomeActivitiesData> {
    const cacheKey = buildProfitDashboardHomeActivitiesCacheKey(
      storeId,
      period,
    );
    return this.redisService.getOrLoadRefreshableJson({
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
    period: DashboardHomePeriodValue,
    now: number,
  ): Promise<DashboardHomeActivitiesData> {
    const cacheKey = buildProfitDashboardHomeActivitiesCacheKey(
      storeId,
      period,
    );
    const data = await loadDashboardHomeActivitiesData(this.prisma, {
      storeId,
      now,
    });
    await this.redisService.writeRefreshableJson(
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
      canUseSpaceManagement: snapshot.canUseSpaceManagement,
      canAccessStoreSettings: snapshot.canAccessStoreSettings,
      canAccessDashboardOverview:
        snapshot.allowedHomeModules.includes('additional') &&
        user.currentMembership?.canAccessHome !== false,
    };
  }
}
