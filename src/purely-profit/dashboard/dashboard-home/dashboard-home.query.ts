import {
  getDayEndTimestamp,
  getDayStartTimestamp,
} from '../../commerce/commerce.utils';
import { PrismaService } from '../../../prisma/prisma.service';
import { DAY_MS } from './dashboard-home.constants';
import {
  DASHBOARD_HOME_ACTIVE_PROMOTION_SELECT,
  DASHBOARD_HOME_OVERDUE_ACCOUNT_SELECT,
  DASHBOARD_HOME_PENDING_WITHDRAWAL_SELECT,
  DASHBOARD_HOME_PRODUCT_ALERT_SELECT,
  DASHBOARD_HOME_SALE_ORDER_SELECT,
  DASHBOARD_HOME_STORE_SELECT,
  DASHBOARD_HOME_UPCOMING_LEAVE_SELECT,
  type AggregatedCostsResult,
  type AggregatedSalesResult,
  type DashboardHomeOverviewData,
  type LoadDashboardHomeOverviewDataParams,
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

export async function loadDashboardHomeOverviewData(
  prisma: PrismaService,
  params: LoadDashboardHomeOverviewDataParams,
): Promise<DashboardHomeOverviewData> {
  const { storeId, currentRange, compareRange, now } = params;
  const trendStart = Math.min(currentRange.start, compareRange.start);
  const trendRange = { start: trendStart, end: currentRange.end };
  const todayStart = getDayStartTimestamp(now);
  const upcomingLeaveEnd = getDayEndTimestamp(todayStart + DAY_MS * 3);

  const [
    store,
    saleTrendRows,
    currentSalesAgg,
    compareSalesAgg,
    currentCostsAgg,
    compareCostsAgg,
    lowStockProducts,
    overdueAccounts,
    activePromotions,
    pendingWithdrawals,
    upcomingLeaves,
  ] = await Promise.all([
    prisma.store.findUnique({
      where: { id: storeId },
      select: DASHBOARD_HOME_STORE_SELECT,
    }),
    prisma.saleOrder.findMany({
      where: buildRangeWhere(storeId, trendRange),
      select: DASHBOARD_HOME_SALE_ORDER_SELECT,
      orderBy: [{ date: 'asc' }, { id: 'asc' }],
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
      where: {
        storeId,
        status: 'overdue',
      },
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

  const currentSales: AggregatedSalesResult = {
    revenue: Number(currentSalesAgg._sum.totalRevenue ?? 0),
    orderCount: currentSalesAgg._count.id,
  };
  const compareSales: AggregatedSalesResult = {
    revenue: Number(compareSalesAgg._sum.totalRevenue ?? 0),
    orderCount: compareSalesAgg._count.id,
  };
  const currentCosts: AggregatedCostsResult = {
    totalCost: Number(currentCostsAgg._sum.amount ?? 0),
  };
  const compareCosts: AggregatedCostsResult = {
    totalCost: Number(compareCostsAgg._sum.amount ?? 0),
  };

  return {
    store,
    saleTrendRows,
    currentSales,
    compareSales,
    currentCosts,
    compareCosts,
    lowStockProducts,
    overdueAccounts,
    activePromotions,
    pendingWithdrawals,
    upcomingLeaves,
  };
}
