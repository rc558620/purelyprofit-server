import {
  getDayEndTimestamp,
  getDayStartTimestamp,
} from '../../commerce/commerce.utils';
import { PrismaService } from '../../../prisma/prisma.service';
import { buildDerivedFinanceAccountStatusWhere } from '../../finance/finance-account.query';
import { DAY_MS } from './dashboard-home.constants';
import {
  DASHBOARD_HOME_ACTIVE_PROMOTION_SELECT,
  DASHBOARD_HOME_OVERDUE_ACCOUNT_SELECT,
  DASHBOARD_HOME_PENDING_WITHDRAWAL_SELECT,
  DASHBOARD_HOME_PRODUCT_ALERT_SELECT,
  DASHBOARD_HOME_STORE_SELECT,
  DASHBOARD_HOME_UPCOMING_LEAVE_SELECT,
  type DashboardHomeActivitiesData,
  type DashboardHomePeriodValue,
  type DashboardHomeStatsData,
  type DashboardHomeTrendRevenueRow,
  type LoadDashboardHomeActivitiesDataParams,
  type LoadDashboardHomeStatsDataParams,
  type LoadDashboardHomeTrendDataParams,
  type TimeRange,
} from './dashboard-home.types';

function buildRangeWhere(
  storeId: number,
  range: TimeRange,
): { storeId: number; date: { gte: Date; lte: Date } } {
  return {
    storeId,
    date: {
      gte: new Date(range.start),
      lte: new Date(range.end),
    },
  };
}

function resolveTrendStart(
  period: DashboardHomePeriodValue,
  currentRange: TimeRange,
): number {
  if (period === 'week') {
    const anchorDayStart = getDayStartTimestamp(currentRange.end);
    return anchorDayStart - DAY_MS * 6;
  }

  return currentRange.start;
}

function resolveTrendSqlGranularity(
  period: DashboardHomePeriodValue,
): 'hour' | 'day' | 'month' {
  if (period === 'today') {
    return 'hour';
  }

  if (period === 'year' || period === 'last_year') {
    return 'month';
  }

  return 'day';
}

export async function loadDashboardHomeStatsData(
  prisma: PrismaService,
  params: LoadDashboardHomeStatsDataParams,
): Promise<DashboardHomeStatsData> {
  const { storeId, currentRange, compareRange } = params;
  const [
    store,
    currentSalesAgg,
    compareSalesAgg,
    currentCostsAgg,
    compareCostsAgg,
  ] = await Promise.all([
    prisma.store.findUnique({
      where: { id: storeId },
      select: DASHBOARD_HOME_STORE_SELECT,
    }),
    prisma.saleOrder.aggregate({
      where: buildRangeWhere(storeId, currentRange),
      _sum: { totalRevenue: true },
      _count: { id: true },
    }),
    prisma.saleOrder.aggregate({
      where: buildRangeWhere(storeId, compareRange),
      _sum: { totalRevenue: true },
      _count: { id: true },
    }),
    prisma.costRecord.aggregate({
      where: buildRangeWhere(storeId, currentRange),
      _sum: { amount: true },
    }),
    prisma.costRecord.aggregate({
      where: buildRangeWhere(storeId, compareRange),
      _sum: { amount: true },
    }),
  ]);

  return {
    store,
    currentSales: {
      revenue: Number(currentSalesAgg._sum.totalRevenue ?? 0),
      orderCount: currentSalesAgg._count.id,
    },
    compareSales: {
      revenue: Number(compareSalesAgg._sum.totalRevenue ?? 0),
      orderCount: compareSalesAgg._count.id,
    },
    currentCosts: {
      totalCost: Number(currentCostsAgg._sum.amount ?? 0),
    },
    compareCosts: {
      totalCost: Number(compareCostsAgg._sum.amount ?? 0),
    },
  };
}

export async function loadDashboardHomeTrendRows(
  prisma: PrismaService,
  params: LoadDashboardHomeTrendDataParams,
): Promise<DashboardHomeTrendRevenueRow[]> {
  const trendStart = resolveTrendStart(params.period, params.currentRange);
  const sqlGranularity = resolveTrendSqlGranularity(params.period);

  return prisma.$queryRaw<DashboardHomeTrendRevenueRow[]>`
    SELECT
      date_trunc(${sqlGranularity}, date) AS "bucketAt",
      COALESCE(SUM(total_revenue), 0) AS revenue
    FROM sale_orders
    WHERE store_id = ${params.storeId}
      AND date >= ${new Date(trendStart)}
      AND date <= ${new Date(params.currentRange.end)}
    GROUP BY 1
    ORDER BY 1 ASC
  `;
}

export async function loadDashboardHomeActivitiesData(
  prisma: PrismaService,
  params: LoadDashboardHomeActivitiesDataParams,
): Promise<DashboardHomeActivitiesData> {
  const { storeId, now } = params;
  const todayStart = getDayStartTimestamp(now);
  const upcomingLeaveEnd = getDayEndTimestamp(todayStart + DAY_MS * 3);

  const [
    lowStockProducts,
    overdueAccounts,
    activePromotions,
    pendingWithdrawals,
    upcomingLeaves,
  ] = await Promise.all([
    prisma.product.findMany({
      where: {
        storeId,
        isActive: true,
      },
      select: DASHBOARD_HOME_PRODUCT_ALERT_SELECT,
      orderBy: [{ stock: 'asc' }, { updatedAt: 'desc' }],
      take: 12,
    }),
    prisma.financeAccountRecord.findMany({
      where: buildDerivedFinanceAccountStatusWhere({
        storeId,
        status: 'overdue',
        now,
      }),
      select: DASHBOARD_HOME_OVERDUE_ACCOUNT_SELECT,
      orderBy: [{ dueDate: 'asc' }, { updatedAt: 'desc' }],
      take: 5,
    }),
    prisma.marketingPromotion.findMany({
      where: {
        storeId,
        enabled: true,
        startAt: {
          lte: new Date(now),
        },
        endAt: {
          gte: new Date(now),
        },
      },
      select: DASHBOARD_HOME_ACTIVE_PROMOTION_SELECT,
      orderBy: [{ endAt: 'asc' }, { updatedAt: 'desc' }],
      take: 5,
    }),
    prisma.partnerWithdrawal.findMany({
      where: {
        storeId,
        status: 'pending',
      },
      select: DASHBOARD_HOME_PENDING_WITHDRAWAL_SELECT,
      orderBy: [{ appliedAt: 'desc' }, { id: 'desc' }],
      take: 5,
    }),
    prisma.employeeLeave.findMany({
      where: {
        storeId,
        startDate: {
          gte: new Date(todayStart),
          lte: new Date(upcomingLeaveEnd),
        },
      },
      select: DASHBOARD_HOME_UPCOMING_LEAVE_SELECT,
      orderBy: [{ startDate: 'asc' }, { createdAt: 'desc' }],
      take: 1,
    }),
  ]);

  return {
    lowStockProducts,
    overdueAccounts,
    activePromotions,
    pendingWithdrawals,
    upcomingLeaves,
  };
}
