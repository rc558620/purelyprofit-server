import {
  EmployeePayrollStatus,
  SpaceReservationStatus as PrismaSpaceReservationStatus,
  Prisma,
} from '@prisma/client';
import { Money } from '../../../shared/money.utils';
import {
  getShanghaiDayEndMs,
  getShanghaiDayStartMs,
  getShanghaiMonth,
  getShanghaiYear,
} from '../../../shared/shanghai-time.utils';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  buildDerivedFinanceAccountStatusWhere,
  buildUpcomingDueAccountWhere,
} from '../../finance/finance-account.query';
import {
  DAY_MS,
  DRAFT_PAYROLL_MAX_MONTHS_AGO,
  MAX_DRAFT_PAYROLL_COUNT,
  MAX_TODAY_RECHARGE_COUNT,
  REVENUE_DECLINE_CONSECUTIVE_DAYS,
  UPCOMING_ACCOUNT_DUE_WITHIN_DAYS,
  UPCOMING_RESERVATION_WITHIN_HOURS,
  VIP_INACTIVE_THRESHOLD_DAYS,
} from './dashboard-home.constants';
import {
  loadInactiveVips,
  loadRecentDailyRevenue,
  loadRecentOrders,
  normalizeRawBucketAt,
} from './dashboard-home.activities.query';
import {
  DASHBOARD_HOME_ACTIVE_PROMOTION_SELECT,
  DASHBOARD_HOME_DRAFT_PAYROLL_SELECT,
  DASHBOARD_HOME_OVERDUE_ACCOUNT_SELECT,
  DASHBOARD_HOME_PENDING_WITHDRAWAL_SELECT,
  DASHBOARD_HOME_PRODUCT_ALERT_SELECT,
  DASHBOARD_HOME_STORE_SELECT,
  DASHBOARD_HOME_TODAY_RECHARGE_SELECT,
  DASHBOARD_HOME_UPCOMING_ACCOUNT_SELECT,
  DASHBOARD_HOME_UPCOMING_LEAVE_SELECT,
  DASHBOARD_HOME_UPCOMING_RESERVATION_SELECT,
  type DashboardHomeActivitiesData,
  type DashboardHomePeriodValue,
  type DashboardHomeStatsData,
  type DashboardHomeTrendRevenueRow,
  type LoadDashboardHomeActivitiesDataParams,
  type LoadDashboardHomeStatsDataParams,
  type LoadDashboardHomeTrendDataParams,
  type TimeRange,
} from './dashboard-home.types';

export {
  loadInactiveVips,
  loadRecentDailyRevenue,
  loadRecentOrders,
  normalizeRawBucketAt,
};

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
    const anchorDayStart = getShanghaiDayStartMs(currentRange.end);
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
    prisma.$queryRaw<[{ revenue: Prisma.Decimal | null; order_count: bigint }]>`
      SELECT
        COALESCE(SUM(soi.sale_price * soi.quantity), 0) AS revenue,
        COUNT(DISTINCT so.id) AS order_count
      FROM sale_order_items soi
      INNER JOIN sale_orders so ON so.id = soi.order_id
      WHERE so.store_id = ${storeId}
        AND so.date >= ${new Date(currentRange.start)}
        AND so.date <= ${new Date(currentRange.end)}
        AND soi.product_name NOT IN ('预付抵扣', '预付款', '续费抵扣')
    `,
    prisma.$queryRaw<[{ revenue: Prisma.Decimal | null; order_count: bigint }]>`
      SELECT
        COALESCE(SUM(soi.sale_price * soi.quantity), 0) AS revenue,
        COUNT(DISTINCT so.id) AS order_count
      FROM sale_order_items soi
      INNER JOIN sale_orders so ON so.id = soi.order_id
      WHERE so.store_id = ${storeId}
        AND so.date >= ${new Date(compareRange.start)}
        AND so.date <= ${new Date(compareRange.end)}
        AND soi.product_name NOT IN ('预付抵扣', '预付款', '续费抵扣')
    `,
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
      revenue: Money.fromDbCents(
        Number(currentSalesAgg[0]?.revenue ?? 0),
      ).toOutputYuan(),
      orderCount: Number(currentSalesAgg[0]?.order_count ?? 0),
    },
    compareSales: {
      revenue: Money.fromDbCents(
        Number(compareSalesAgg[0]?.revenue ?? 0),
      ).toOutputYuan(),
      orderCount: Number(compareSalesAgg[0]?.order_count ?? 0),
    },
    currentCosts: {
      totalCost: Money.fromDbCents(
        currentCostsAgg._sum.amount ?? 0,
      ).toOutputYuan(),
    },
    compareCosts: {
      totalCost: Money.fromDbCents(
        compareCostsAgg._sum.amount ?? 0,
      ).toOutputYuan(),
    },
  };
}

export async function loadDashboardHomeTrendRows(
  prisma: PrismaService,
  params: LoadDashboardHomeTrendDataParams,
): Promise<DashboardHomeTrendRevenueRow[]> {
  const trendStart = resolveTrendStart(params.period, params.currentRange);
  const sqlGranularity = resolveTrendSqlGranularity(params.period);

  const rows = await prisma.$queryRaw<DashboardHomeTrendRevenueRow[]>`
    SELECT
      date_trunc(${sqlGranularity}, so.date + interval '8 hours') - interval '8 hours' AS "bucketAt",
      COALESCE(SUM(soi.sale_price * soi.quantity), 0) AS revenue
    FROM sale_order_items soi
    INNER JOIN sale_orders so ON so.id = soi.order_id
    WHERE so.store_id = ${params.storeId}
      AND so.date >= ${new Date(trendStart)}
      AND so.date <= ${new Date(params.currentRange.end)}
      AND soi.product_name NOT IN ('预付抵扣', '预付款', '续费抵扣')
    GROUP BY 1
    ORDER BY 1 ASC
  `;

  return normalizeRawBucketAt(rows);
}

export async function loadDashboardHomeActivitiesData(
  prisma: PrismaService,
  params: LoadDashboardHomeActivitiesDataParams,
): Promise<DashboardHomeActivitiesData> {
  const { storeId, now } = params;
  const todayStart = getShanghaiDayStartMs(now);
  const todayEnd = getShanghaiDayEndMs(now);
  const upcomingLeaveEnd = getShanghaiDayEndMs(todayStart + DAY_MS * 3);
  const reservationWindowEnd =
    now + UPCOMING_RESERVATION_WITHIN_HOURS * 60 * 60 * 1000;
  const vipInactiveThreshold = new Date(
    now - VIP_INACTIVE_THRESHOLD_DAYS * DAY_MS,
  );
  const revenueLookbackStart = getShanghaiDayStartMs(
    now - (REVENUE_DECLINE_CONSECUTIVE_DAYS + 1) * DAY_MS,
  );

  const [
    lowStockProducts,
    overdueAccounts,
    activePromotions,
    pendingWithdrawals,
    upcomingLeaves,
    todayNewMemberCount,
    todayRecharges,
    upcomingReservations,
    upcomingAccounts,
    draftPayrolls,
    inactiveVips,
    dailyRevenueRows,
    recentOrders,
  ] = await Promise.all([
    prisma.product.findMany({
      where: {
        storeId,
        deletedAt: null,
        isActive: true,
        alertThreshold: { gt: 0 },
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
    prisma.member.count({
      where: {
        storeId,
        createdAt: {
          gte: new Date(todayStart),
          lte: new Date(todayEnd),
        },
      },
    }),
    prisma.memberRechargeLog.findMany({
      where: {
        storeId,
        createdAt: {
          gte: new Date(todayStart),
          lte: new Date(todayEnd),
        },
      },
      select: DASHBOARD_HOME_TODAY_RECHARGE_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: MAX_TODAY_RECHARGE_COUNT,
    }),
    prisma.spaceReservation.findMany({
      where: {
        storeId,
        status: PrismaSpaceReservationStatus.pending,
        reservedAt: {
          gte: new Date(now),
          lte: new Date(reservationWindowEnd),
        },
      },
      select: DASHBOARD_HOME_UPCOMING_RESERVATION_SELECT,
      orderBy: [{ reservedAt: 'asc' }, { id: 'asc' }],
      take: 3,
    }),
    prisma.financeAccountRecord.findMany({
      where: buildUpcomingDueAccountWhere({
        storeId,
        now,
        withinDays: UPCOMING_ACCOUNT_DUE_WITHIN_DAYS,
      }),
      select: DASHBOARD_HOME_UPCOMING_ACCOUNT_SELECT,
      orderBy: [{ dueDate: 'asc' }, { updatedAt: 'desc' }],
      take: 5,
    }),
    prisma.employeePayroll.findMany({
      where: {
        storeId,
        status: EmployeePayrollStatus.draft,
        month: {
          gte: buildRecentPayrollMonthFilter(),
        },
      },
      select: DASHBOARD_HOME_DRAFT_PAYROLL_SELECT,
      orderBy: [{ month: 'desc' }, { updatedAt: 'desc' }],
      take: MAX_DRAFT_PAYROLL_COUNT,
    }),
    loadInactiveVips(prisma, storeId, vipInactiveThreshold),
    loadRecentDailyRevenue(prisma, storeId, revenueLookbackStart, now),
    loadRecentOrders(prisma, storeId, todayStart, now),
  ]);

  return {
    lowStockProducts,
    overdueAccounts,
    activePromotions,
    pendingWithdrawals,
    upcomingLeaves,
    todayNewMemberCount,
    todayRecharges,
    upcomingReservations,
    upcomingAccounts,
    draftPayrolls,
    inactiveVips,
    dailyRevenueRows,
    recentOrders,
  };
}

/**
 * 生成近 DRAFT_PAYROLL_MAX_MONTHS_AGO 个月的月份过滤下界（月初零点 UTC）。
 * 用于只查近期未确认的工资单，避免把历史遗留草稿也拉出来。
 *
 * EmployeePayroll.month 已改为 DateTime 类型（存储每月 1 日的时间戳），
 * 因此这里返回 Date 而非 string，确保 Prisma where 条件类型匹配。
 */
function buildRecentPayrollMonthFilter(): Date {
  const nowMs = Date.now();
  // 「当前月份」按上海时区判定，避免 UTC 下月初/月末误判
  const year = getShanghaiYear(nowMs);
  const month = getShanghaiMonth(nowMs) - DRAFT_PAYROLL_MAX_MONTHS_AGO;
  // 用 UTC 月初零点，与 employees-payroll.service.ts 中 normalizeMonthValue 保持一致
  return new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
}
