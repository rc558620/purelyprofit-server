import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { NewCustomerQuotaService } from '../../member/new-customer-quota/new-customer-quota.service';
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
import {
  DashboardHomeCapabilityService,
  type DashboardHomeCapabilitySnapshot,
} from './dashboard-home.capability.service';

const PROFIT_DASHBOARD_HOME_CACHE_TTL_SECONDS = 30;
const PROFIT_DASHBOARD_HOME_STATS_REFRESH_AFTER_MS = 10_000;
const PROFIT_DASHBOARD_HOME_TREND_CACHE_TTL_SECONDS = 60;
const PROFIT_DASHBOARD_HOME_TREND_REFRESH_AFTER_MS = 20_000;
const PROFIT_DASHBOARD_HOME_ACTIVITIES_CACHE_TTL_SECONDS = 45;
const PROFIT_DASHBOARD_HOME_ACTIVITIES_REFRESH_AFTER_MS = 15_000;

/** getOverview 解析出的请求上下文：门店、周期与随登录身份变化的能力快照 */
interface DashboardHomeOverviewContext {
  storeId: number;
  period: DashboardHomePeriodValue;
  capabilitySnapshot: DashboardHomeCapabilitySnapshot;
}

/** 概览主体组装入参：refresh 决定复用缓存回源还是强制刷新后回写缓存 */
interface DashboardHomeOverviewComposeInput {
  storeId: number;
  period: DashboardHomePeriodValue;
  refresh: boolean;
}

@Injectable()
export class DashboardHomeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly refreshableCache: RefreshableCacheService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly capabilityService: DashboardHomeCapabilityService,
    private readonly quotaService: NewCustomerQuotaService,
  ) {}

  async getOverview(
    user: AuthenticatedUser,
    queryDto: GetDashboardHomeOverviewQueryDto,
  ): Promise<DashboardHomeOverviewResponseDto> {
    const { storeId, period, capabilitySnapshot } =
      await this.resolveOverviewContext(user, queryDto);

    // 概览主体（不含 capability）按门店+周期整包缓存，命中即直接返回。
    // capability 与登录用户相关，必须实时计算，不能进缓存。
    const cachedOverview =
      await this.redisService.getJson<DashboardHomeOverviewWithoutCapability>(
        buildProfitDashboardHomeCacheKey(storeId, period),
      );
    if (cachedOverview) {
      return { ...cachedOverview, capability: capabilitySnapshot };
    }

    const overview = await this.composeAndCacheOverview({
      storeId,
      period,
      refresh: false,
    });
    return { ...overview, capability: capabilitySnapshot };
  }

  async warmOverviewCache(
    storeId: number,
    period: NonNullable<GetDashboardHomeOverviewQueryDto['period']> | 'today',
  ): Promise<DashboardHomeOverviewWithoutCapability> {
    return this.composeAndCacheOverview({ storeId, period, refresh: true });
  }

  /**
   * 解析门店、周期与能力快照。
   *
   * 权限裁决只依赖身份维度，先按登录态自带的门店 ID 取一次能力快照；
   * 真实门店 ID 与预估不一致时按真实值重算：否则会用 storeId=0 算出空能力，
   * 导致业态能力（餐饮/空间/扫码点单）被错误降级为 false。
   */
  private async resolveOverviewContext(
    user: AuthenticatedUser,
    queryDto: GetDashboardHomeOverviewQueryDto,
  ): Promise<DashboardHomeOverviewContext> {
    const query = buildDashboardHomeQueryInput(queryDto);
    const period = query.period ?? 'today';
    const preliminaryStoreId =
      user.currentMembership?.storeId ?? query.storeId ?? 0;
    const preliminaryCapability = await this.capabilityService.loadSnapshot(
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
    const capabilitySnapshot =
      storeId === preliminaryStoreId
        ? preliminaryCapability
        : await this.capabilityService.loadSnapshot(user, storeId);

    return { storeId, period, capabilitySnapshot };
  }

  private async composeAndCacheOverview(
    input: DashboardHomeOverviewComposeInput,
  ): Promise<DashboardHomeOverviewWithoutCapability> {
    const { storeId, period, refresh } = input;
    const currentRange = buildCurrentRange(period);
    const compareRange = buildCompareRange(period, currentRange);
    const now = Date.now();
    const [statsData, salesTrend, activitiesData, quotaOverview] =
      await Promise.all([
        refresh
          ? this.refreshStatsCache(storeId, period, currentRange, compareRange)
          : this.loadStatsCache(storeId, period, currentRange, compareRange),
        refresh
          ? this.refreshTrendCache(storeId, period, currentRange)
          : this.loadTrendCache(storeId, period, currentRange),
        refresh
          ? this.refreshActivitiesCache(storeId, now)
          : this.loadActivitiesCache(storeId, now),
        this.quotaService.getOverview(storeId),
      ]);
    const overview = buildDashboardHomeOverviewResponse({
      period,
      storeId,
      currentRange,
      compareRange,
      now,
      statsData,
      salesTrend,
      activitiesData,
      quota: this.toQuotaDto(quotaOverview),
    });

    await this.redisService.setJson(
      buildProfitDashboardHomeCacheKey(storeId, period),
      overview,
      PROFIT_DASHBOARD_HOME_CACHE_TTL_SECONDS,
    );

    return overview;
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
}
