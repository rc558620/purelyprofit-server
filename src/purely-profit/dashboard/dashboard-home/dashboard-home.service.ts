import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PlatformMembershipAccessService } from '../../member/platform-membership/platform-membership-access.service';
import { NewCustomerQuotaService } from '../../member/new-customer-quota/new-customer-quota.service';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  buildCacheRefreshTaskKey,
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
  loadDashboardHomeStatsData,
  loadDashboardHomeTrendRows,
} from './dashboard-home.query';
import { loadDashboardHomeActivitiesChunks } from './dashboard-home.activities-cache';
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
import { DashboardHomeCapabilityService } from './dashboard-home.capability.service';
import { applyCapabilityToOverview } from './dashboard-home.response.utils';
import { assertPeriodReadableByMembership } from './dashboard-home.entitlement';

const PROFIT_DASHBOARD_HOME_CACHE_TTL_SECONDS = 30;
const PROFIT_DASHBOARD_HOME_STATS_REFRESH_AFTER_MS = 10_000;
const PROFIT_DASHBOARD_HOME_TREND_CACHE_TTL_SECONDS = 60;
const PROFIT_DASHBOARD_HOME_TREND_REFRESH_AFTER_MS = 20_000;

/** 概览主体组装入参：refresh 决定复用缓存回源还是强制刷新后回写缓存 */
interface DashboardHomeOverviewComposeInput {
  storeId: number;
  period: DashboardHomePeriodValue;
  refresh: boolean;
  /** 请求级时间基准，必须与其他子块同源，见 buildCurrentRange 注释 */
  now: number;
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
    private readonly platformMembershipAccessService: PlatformMembershipAccessService,
  ) {}

  async getOverview(
    user: AuthenticatedUser,
    queryDto: GetDashboardHomeOverviewQueryDto,
  ): Promise<DashboardHomeOverviewResponseDto> {
    const query = buildDashboardHomeQueryInput(queryDto);
    const period = query.period ?? 'today';
    // 统一时间基准：周期区间、动态流时间窗口、meta.generatedAt 必须同源，
    // 否则跨零点请求会返回「统计属于昨天、动态属于今天」的混合快照
    const now = Date.now();
    const preliminaryStoreId =
      user.currentMembership?.storeId ?? query.storeId ?? 0;

    // 能力快照与「预估门店」的概览缓存互不依赖，并行取：命中路径原本是
    // 能力快照 → 权限裁决 → 概览缓存 三次串行往返，现在把最后一次提前。
    // 若权限裁决换到了别的门店，这里多读的一次 Redis 直接丢弃（预估门店
    // 通常就是当前门店，换店是少数路径）。
    const [preliminaryCapability, preliminaryCachedOverview] =
      await Promise.all([
        this.capabilityService.loadSnapshot(user, preliminaryStoreId),
        preliminaryStoreId > 0
          ? this.redisService.getJson<DashboardHomeOverviewWithoutCapability>(
              buildProfitDashboardHomeCacheKey(preliminaryStoreId, period),
            )
          : Promise.resolve(null),
      ]);

    const requiredPermission = preliminaryCapability.canAccessDashboardOverview
      ? 'operation-entry:view'
      : 'report:view';
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      query.storeId,
      requiredPermission,
      '无权查看该门店首页概览',
    );

    /*
     * 会员套餐历史窗口校验必须发生在读缓存之前：套餐降级后，超出新窗口的
     * 周期缓存仍在 TTL 内，只靠前端隐藏「本月/今年」按钮拦不住直接构造的请求。
     * 校验拒绝而不是裁剪，是为了避免返回「区间被截断、标签仍写今年」的误导数据。
     */
    await assertPeriodReadableByMembership(this.platformMembershipAccessService, {
      storeId,
      period,
      now,
      callerIsSubAccount: user.currentMembership?.subjectType === 'sub_account',
    });

    // 预估门店与真实门店一致（绝大多数请求）：直接用并行取到的缓存。
    if (storeId === preliminaryStoreId) {
      if (preliminaryCachedOverview) {
        return applyCapabilityToOverview(
          preliminaryCachedOverview,
          preliminaryCapability,
        );
      }

      const overview = await this.composeAndCacheOverview({
        storeId,
        period,
        refresh: false,
        now,
      });
      return applyCapabilityToOverview(overview, preliminaryCapability);
    }

    // 权限裁决落到其它门店：按真实门店重算能力快照，再走常规缓存路径。
    // （真实门店的能力不能复用 storeId=0 / 别的门店的快照，否则业态能力会被误降级）
    const capabilitySnapshot = await this.capabilityService.loadSnapshot(
      user,
      storeId,
    );
    const cachedOverview =
      await this.redisService.getJson<DashboardHomeOverviewWithoutCapability>(
        buildProfitDashboardHomeCacheKey(storeId, period),
      );
    if (cachedOverview) {
      return applyCapabilityToOverview(cachedOverview, capabilitySnapshot);
    }

    const overview = await this.composeAndCacheOverview({
      storeId,
      period,
      refresh: false,
      now,
    });
    return applyCapabilityToOverview(overview, capabilitySnapshot);
  }

  async warmOverviewCache(
    storeId: number,
    period: NonNullable<GetDashboardHomeOverviewQueryDto['period']> | 'today',
  ): Promise<DashboardHomeOverviewWithoutCapability> {
    return this.composeAndCacheOverview({
      storeId,
      period,
      refresh: true,
      now: Date.now(),
    });
  }

  private async composeAndCacheOverview(
    input: DashboardHomeOverviewComposeInput,
  ): Promise<DashboardHomeOverviewWithoutCapability> {
    const { storeId, period, refresh, now } = input;
    const currentRange = buildCurrentRange(period, now);
    const compareRange = buildCompareRange(period, currentRange);
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
   *
   * 内部按「实时 / 状态」两块分别缓存：实时块 45s，状态块 5 分钟，
   * 稳态下把动态流的 DB 查询触发频率降下来，见 dashboard-home.activities-cache.ts。
   */
  private async loadActivitiesCache(
    storeId: number,
    now: number,
  ): Promise<DashboardHomeActivitiesData> {
    return loadDashboardHomeActivitiesChunks({
      cache: this.refreshableCache,
      prisma: this.prisma,
      storeId,
      now,
      refresh: false,
    });
  }

  private async refreshActivitiesCache(
    storeId: number,
    now: number,
  ): Promise<DashboardHomeActivitiesData> {
    return loadDashboardHomeActivitiesChunks({
      cache: this.refreshableCache,
      prisma: this.prisma,
      storeId,
      now,
      refresh: true,
    });
  }
}
