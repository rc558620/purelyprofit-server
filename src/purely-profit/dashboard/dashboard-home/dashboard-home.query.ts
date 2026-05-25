import {
  getDayEndTimestamp,
  getDayStartTimestamp,
} from '../../commerce/commerce.utils';
import { PrismaService } from '../../../prisma/prisma.service';
import { DAY_MS } from './dashboard-home.constants';
import {
  DASHBOARD_HOME_ACTIVE_PROMOTION_SELECT,
  DASHBOARD_HOME_COST_RECORD_SELECT,
  DASHBOARD_HOME_OVERDUE_ACCOUNT_SELECT,
  DASHBOARD_HOME_PENDING_WITHDRAWAL_SELECT,
  DASHBOARD_HOME_PRODUCT_ALERT_SELECT,
  DASHBOARD_HOME_SALE_ORDER_SELECT,
  DASHBOARD_HOME_STORE_SELECT,
  DASHBOARD_HOME_UPCOMING_LEAVE_SELECT,
  type DashboardHomeOverviewData,
  type LoadDashboardHomeOverviewDataParams,
} from './dashboard-home.types';

export async function loadDashboardHomeOverviewData(
  prisma: PrismaService,
  params: LoadDashboardHomeOverviewDataParams,
): Promise<DashboardHomeOverviewData> {
  const { storeId, currentRange, compareRange, now } = params;
  const queryStart = Math.min(currentRange.start, compareRange.start);
  const todayStart = getDayStartTimestamp(now);
  const upcomingLeaveEnd = getDayEndTimestamp(todayStart + DAY_MS * 3);

  const [
    store,
    saleOrders,
    costRecords,
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
      where: {
        storeId,
        date: {
          gte: new Date(queryStart),
          lte: new Date(currentRange.end),
        },
      },
      select: DASHBOARD_HOME_SALE_ORDER_SELECT,
      orderBy: [{ date: 'asc' }, { id: 'asc' }],
    }),
    prisma.costRecord.findMany({
      where: {
        storeId,
        date: {
          gte: new Date(queryStart),
          lte: new Date(currentRange.end),
        },
      },
      select: DASHBOARD_HOME_COST_RECORD_SELECT,
      orderBy: [{ date: 'asc' }, { id: 'asc' }],
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

  return {
    store,
    saleOrders,
    costRecords,
    lowStockProducts,
    overdueAccounts,
    activePromotions,
    pendingWithdrawals,
    upcomingLeaves,
  };
}
