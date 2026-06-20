import type {
  DashboardHomeMetaDto,
  DashboardHomeOverviewResponseDto,
  DashboardHomeSalesTrendDto,
} from './dto/dashboard-home-response.dto';
import type {
  DashboardHomeActivitiesData,
  DashboardHomePeriodValue,
  DashboardHomeStatsData,
  TimeRange,
} from './dashboard-home.types';
import {
  buildDashboardHomeActivities,
  buildDashboardHomeStats,
} from './dashboard-home.utils';

export type DashboardHomeOverviewWithoutCapability = Omit<
  DashboardHomeOverviewResponseDto,
  'capability'
>;

export function buildDashboardHomeOverviewResponse(params: {
  period: DashboardHomePeriodValue;
  storeId: number;
  currentRange: TimeRange;
  compareRange: TimeRange;
  now: number;
  statsData: DashboardHomeStatsData;
  salesTrend: DashboardHomeSalesTrendDto;
  activitiesData: DashboardHomeActivitiesData;
}): DashboardHomeOverviewWithoutCapability {
  const {
    period,
    storeId,
    currentRange,
    compareRange,
    now,
    statsData,
    salesTrend,
    activitiesData,
  } = params;

  return {
    stats: buildDashboardHomeStats(
      period,
      statsData.currentSales,
      statsData.compareSales,
      statsData.currentCosts,
      statsData.compareCosts,
    ),
    salesTrend,
    activities: buildDashboardHomeActivities({
      period,
      currentSales: statsData.currentSales,
      compareSales: statsData.compareSales,
      lowStockProducts: activitiesData.lowStockProducts,
      overdueAccounts: activitiesData.overdueAccounts,
      activePromotions: activitiesData.activePromotions,
      pendingWithdrawals: activitiesData.pendingWithdrawals,
      upcomingLeave: activitiesData.upcomingLeaves[0],
      todayNewMemberCount: activitiesData.todayNewMemberCount,
      todayRecharges: activitiesData.todayRecharges,
      upcomingReservations: activitiesData.upcomingReservations,
      upcomingAccounts: activitiesData.upcomingAccounts,
      draftPayrolls: activitiesData.draftPayrolls,
      inactiveVips: activitiesData.inactiveVips,
      dailyRevenueRows: activitiesData.dailyRevenueRows,
      recentOrders: activitiesData.recentOrders,
    }),
    meta: buildDashboardHomeMeta(
      period,
      storeId,
      currentRange,
      compareRange,
      now,
      statsData,
    ),
  };
}

function buildDashboardHomeMeta(
  period: DashboardHomePeriodValue,
  storeId: number,
  currentRange: TimeRange,
  compareRange: TimeRange,
  now: number,
  statsData: DashboardHomeStatsData,
): DashboardHomeMetaDto {
  return {
    period,
    storeId,
    storeName: statsData.store?.name ?? `门店 ${storeId}`,
    startAt: currentRange.start,
    endAt: currentRange.end,
    compareStartAt: compareRange.start,
    compareEndAt: compareRange.end,
    generatedAt: now,
  };
}
