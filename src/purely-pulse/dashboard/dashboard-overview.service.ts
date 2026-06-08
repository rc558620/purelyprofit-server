import { Injectable } from '@nestjs/common';
import { BusinessAnalysisService } from '../../purely-profit/dashboard/business-analysis/business-analysis.service';
import type { GetBusinessAnalysisQueryDto } from '../../purely-profit/dashboard/business-analysis/dto/business-analysis-query.dto';
import type { BusinessAnalysisResponseDto } from '../../purely-profit/dashboard/business-analysis/dto/business-analysis-response.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { buildCacheRefreshTaskKey } from '../../redis/keys';
import { buildPulseDashboardOverviewCacheKey } from '../pulse.cache-keys';
import { RedisService } from '../../redis/redis.service';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PulseStoreContextService } from '../pulse-store-context.service';
import type { PulseTargetStoreSummary } from '../pulse-store-context.types';
import { DashboardAggregatorService } from './dashboard-aggregator.service';
import {
  DEFAULT_DASHBOARD_ANALYSIS_PERIOD,
  DEFAULT_DASHBOARD_OVERVIEW_PERIOD,
  DEFAULT_DASHBOARD_STORES_PERIOD,
  PERIOD_ORDER_LABEL,
  PERIOD_PROFIT_LABEL,
} from './dashboard.constants';
import type {
  DashboardOverviewCompareStats,
  DashboardOverviewCurrentStats,
  DashboardStoreRankContext,
  DashboardStoreSummaryRow,
} from './dashboard.types';
import {
  calculatePercentChange,
  calculateRatioPercent,
  subtractMoney,
} from './dashboard-math.utils';
import {
  buildDashboardSalesTrend,
  buildDashboardTrendQueryRange,
} from './dashboard-trend.utils';
import {
  buildCompareRange,
  buildCurrentRange,
  type TimeRange,
} from './dashboard-time.utils';
import type {
  GetPulseDashboardAnalysisQueryDto,
  GetPulseDashboardOverviewQueryDto,
  GetPulseDashboardStoresQueryDto,
  PulseDashboardPeriodValue,
} from './dto/pulse-dashboard-query.dto';
import type {
  PulseDashboardMetaDto,
  PulseDashboardOverviewResponseDto,
  PulseDashboardSalesTrendDto,
  PulseDashboardStatsDto,
  PulseDashboardStoreRankItemDto,
  PulseDashboardStoresResponseDto,
} from './dto/pulse-dashboard-overview.response.dto';

const PULSE_DASHBOARD_OVERVIEW_CACHE_TTL_SECONDS = 20;
const PULSE_DASHBOARD_OVERVIEW_REFRESH_AFTER_MS = 10_000;

@Injectable()
export class PulseDashboardOverviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly dashboardAggregatorService: DashboardAggregatorService,
    private readonly businessAnalysisService: BusinessAnalysisService,
    private readonly pulseStoreContextService: PulseStoreContextService,
  ) {}

  async getOverview(
    user: AuthenticatedUser,
    queryDto: GetPulseDashboardOverviewQueryDto,
  ): Promise<PulseDashboardOverviewResponseDto> {
    const period = queryDto.period ?? DEFAULT_DASHBOARD_OVERVIEW_PERIOD;
    const targetStore = await this.resolveDashboardTargetStore(
      user,
      queryDto.storeId,
      '当前未选中目标门店，暂无法查看经营总览',
    );
    const cacheKey = buildPulseDashboardOverviewCacheKey(
      targetStore.id,
      period,
    );

    return this.redisService.getOrLoadRefreshableJson({
      cacheKey,
      taskKey: buildCacheRefreshTaskKey(cacheKey),
      ttlSeconds: PULSE_DASHBOARD_OVERVIEW_CACHE_TTL_SECONDS,
      refreshAfterMs: PULSE_DASHBOARD_OVERVIEW_REFRESH_AFTER_MS,
      loadValue: () => this.buildOverview(targetStore, period),
    });
  }

  async getStores(
    user: AuthenticatedUser,
    queryDto: GetPulseDashboardStoresQueryDto,
  ): Promise<PulseDashboardStoresResponseDto> {
    const period = queryDto.period ?? DEFAULT_DASHBOARD_STORES_PERIOD;
    const targetStore = await this.resolveDashboardTargetStore(
      user,
      queryDto.storeId,
      '当前未选中目标门店，暂无法查看门店排行',
    );
    const storeIds = [targetStore.id];
    const currentRange = buildCurrentRange(period);

    const storeRows: DashboardStoreSummaryRow[] =
      await this.prisma.store.findMany({
        where: { id: { in: storeIds } },
        select: { id: true, name: true, address: true },
      });

    const [salesTotals, costTotals] = await Promise.all([
      this.dashboardAggregatorService.aggregateSalesByStore(
        storeIds,
        currentRange,
      ),
      this.dashboardAggregatorService.aggregateCostsByStore(
        storeIds,
        currentRange,
      ),
    ]);

    const storeRankContexts: DashboardStoreRankContext[] = storeRows.map(
      (store) => ({
        store,
        sales: salesTotals[store.id] ?? {
          totalRevenue: 0,
          totalProfit: 0,
          orderCount: 0,
        },
        totalCost: costTotals[store.id] ?? 0,
      }),
    );

    const stores: PulseDashboardStoreRankItemDto[] = storeRankContexts.map(
      ({ store, sales, totalCost }) => {
        const profit = subtractMoney(sales.totalRevenue, totalCost);
        const profitRate = calculateRatioPercent(profit, sales.totalRevenue, 2);

        return {
          storeId: store.id,
          storeName: store.name,
          address: store.address,
          profit,
          revenue: sales.totalRevenue,
          totalCost,
          orderCount: sales.orderCount,
          profitRate,
          rank: 0,
        };
      },
    );

    stores.sort((left, right) => right.profit - left.profit);
    stores.forEach((item, index) => {
      item.rank = index + 1;
    });

    return {
      meta: this.buildMeta(
        period,
        targetStore.id,
        storeIds.length,
        currentRange,
      ),
      stores,
    };
  }

  async getAnalysis(
    user: AuthenticatedUser,
    queryDto: GetPulseDashboardAnalysisQueryDto,
  ): Promise<BusinessAnalysisResponseDto> {
    const targetStore = await this.resolveDashboardTargetStore(
      user,
      queryDto.storeId,
      '当前未选中目标门店，暂无法查看经营分析',
    );

    const analysisPeriod: GetBusinessAnalysisQueryDto['period'] =
      queryDto.period ?? DEFAULT_DASHBOARD_ANALYSIS_PERIOD;
    const proxyQuery: GetBusinessAnalysisQueryDto = {
      period: analysisPeriod,
      storeId: targetStore.id,
      startTime: queryDto.startTime,
      endTime: queryDto.endTime,
    };

    return this.businessAnalysisService.getAnalysisByStoreId(
      targetStore.id,
      proxyQuery,
    );
  }

  private async buildOverview(
    targetStore: PulseTargetStoreSummary,
    period: PulseDashboardPeriodValue,
  ): Promise<PulseDashboardOverviewResponseDto> {
    const storeIds = [targetStore.id];
    const currentRange = buildCurrentRange(period);
    const compareRange = buildCompareRange(period, currentRange);

    const [currentAgg, compareAgg, costSum, compareCostSum] = await Promise.all(
      [
        this.dashboardAggregatorService.aggregateSales(storeIds, currentRange),
        this.dashboardAggregatorService.aggregateSales(storeIds, compareRange),
        this.dashboardAggregatorService.aggregateCosts(storeIds, currentRange),
        this.dashboardAggregatorService.aggregateCosts(storeIds, compareRange),
      ],
    );

    const currentProfit = subtractMoney(currentAgg.totalRevenue, costSum);
    const compareProfit = subtractMoney(
      compareAgg.totalRevenue,
      compareCostSum,
    );

    return {
      stats: this.buildStats(
        period,
        currentAgg,
        compareAgg,
        currentProfit,
        compareProfit,
        costSum,
      ),
      salesTrend: await this.buildSalesTrend(storeIds, period, currentRange),
      meta: this.buildMeta(
        period,
        targetStore.id,
        storeIds.length,
        currentRange,
      ),
    };
  }

  private async resolveDashboardTargetStore(
    user: AuthenticatedUser,
    requestedStoreId: number | undefined,
    notFoundMessage: string,
  ): Promise<PulseTargetStoreSummary> {
    return this.pulseStoreContextService.resolveTargetStoreOrThrow(user, {
      requestedStoreId,
      persistResolvedSelection: true,
      notFoundMessage,
    });
  }

  private async buildSalesTrend(
    storeIds: number[],
    period: PulseDashboardPeriodValue,
    currentRange: TimeRange,
  ): Promise<PulseDashboardSalesTrendDto> {
    const rows = await this.prisma.saleOrder.findMany({
      where: {
        storeId: { in: storeIds },
        date: buildDashboardTrendQueryRange(currentRange),
      },
      select: { totalRevenue: true, date: true },
      ...(period === 'year' || period === 'today'
        ? {}
        : { orderBy: [{ date: 'asc' }, { id: 'asc' }] }),
    });

    return buildDashboardSalesTrend(rows, period);
  }

  private buildStats(
    period: PulseDashboardPeriodValue,
    current: DashboardOverviewCurrentStats,
    compare: DashboardOverviewCompareStats,
    currentProfit: number,
    compareProfit: number,
    currentCost: number,
  ): PulseDashboardStatsDto {
    return {
      profitLabel: PERIOD_PROFIT_LABEL[period],
      profit: currentProfit,
      profitChange:
        calculatePercentChange(currentProfit, compareProfit, {
          absoluteBase: true,
        }) ?? null,
      orderLabel: PERIOD_ORDER_LABEL[period],
      orderCount: current.orderCount,
      orderChange:
        calculatePercentChange(current.orderCount, compare.orderCount) ?? null,
      revenue: current.totalRevenue,
      totalCost: currentCost,
    };
  }

  private buildMeta(
    period: PulseDashboardPeriodValue,
    storeId: number | null,
    storeCount: number,
    currentRange: TimeRange,
  ): PulseDashboardMetaDto {
    return {
      period,
      storeId,
      storeCount,
      startAt: currentRange.start,
      endAt: currentRange.end,
      generatedAt: Date.now(),
    };
  }
}
