import type {
  DashboardHomeMetaDto,
  DashboardHomeOverviewResponseDto,
} from './dto/dashboard-home-response.dto';

export type DashboardHomeOverviewWithoutCapability = Omit<
  DashboardHomeOverviewResponseDto,
  'capability'
>;
import type { BuildDashboardHomeOverviewResponseParams } from './dashboard-home.types';
import {
  buildDashboardHomeActivities,
  buildDashboardHomeSalesTrend,
  buildDashboardHomeStats,
} from './dashboard-home.utils';

export function buildDashboardHomeOverviewResponse(
  params: BuildDashboardHomeOverviewResponseParams,
): DashboardHomeOverviewWithoutCapability {
  const { period, storeId, currentRange, compareRange, now, overviewData } =
    params;

  return {
    stats: buildDashboardHomeStats(
      period,
      overviewData.currentSales,
      overviewData.compareSales,
      overviewData.currentCosts,
      overviewData.compareCosts,
    ),
    salesTrend: buildDashboardHomeSalesTrend(
      period,
      currentRange,
      overviewData.saleTrendRows,
    ),
    activities: buildDashboardHomeActivities({
      period,
      currentSales: overviewData.currentSales,
      compareSales: overviewData.compareSales,
      lowStockProducts: overviewData.lowStockProducts,
      overdueAccounts: overviewData.overdueAccounts,
      activePromotions: overviewData.activePromotions,
      pendingWithdrawals: overviewData.pendingWithdrawals,
      upcomingLeave: overviewData.upcomingLeaves[0],
    }),
    meta: buildDashboardHomeMeta(
      period,
      storeId,
      currentRange,
      compareRange,
      now,
      overviewData,
    ),
  };
}

function buildDashboardHomeMeta(
  period: BuildDashboardHomeOverviewResponseParams['period'],
  storeId: number,
  currentRange: BuildDashboardHomeOverviewResponseParams['currentRange'],
  compareRange: BuildDashboardHomeOverviewResponseParams['compareRange'],
  now: number,
  overviewData: BuildDashboardHomeOverviewResponseParams['overviewData'],
): DashboardHomeMetaDto {
  return {
    period,
    storeId,
    storeName: overviewData.store?.name ?? `门店 ${storeId}`,
    startAt: currentRange.start,
    endAt: currentRange.end,
    compareStartAt: compareRange.start,
    compareEndAt: compareRange.end,
    generatedAt: now,
  };
}
