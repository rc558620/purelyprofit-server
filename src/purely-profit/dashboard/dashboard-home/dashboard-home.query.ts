import {
  EmployeePayrollStatus,
  SpaceReservationStatus as PrismaSpaceReservationStatus,
  Prisma,
} from '@prisma/client';
import {
  getDayEndTimestamp,
  getDayStartTimestamp,
} from '../../commerce/commerce.utils';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  buildDerivedFinanceAccountStatusWhere,
  buildUpcomingDueAccountWhere,
} from '../../finance/finance-account.query';
import {
  DAY_MS,
  DRAFT_PAYROLL_MAX_MONTHS_AGO,
  MAX_DRAFT_PAYROLL_COUNT,
  MAX_INACTIVE_VIP_COUNT,
  MAX_RECENT_ORDER_COUNT,
  MAX_TODAY_RECHARGE_COUNT,
  RECENT_ORDER_MIN_COUNT,
  RECENT_ORDER_WINDOW_HOURS,
  REVENUE_DECLINE_CONSECUTIVE_DAYS,
  UPCOMING_ACCOUNT_DUE_WITHIN_DAYS,
  UPCOMING_RESERVATION_WITHIN_HOURS,
  VIP_INACTIVE_THRESHOLD_DAYS,
} from './dashboard-home.constants';
import {
  DASHBOARD_HOME_ACTIVE_PROMOTION_SELECT,
  DASHBOARD_HOME_DRAFT_PAYROLL_SELECT,
  DASHBOARD_HOME_OVERDUE_ACCOUNT_SELECT,
  DASHBOARD_HOME_PENDING_WITHDRAWAL_SELECT,
  DASHBOARD_HOME_PRODUCT_ALERT_SELECT,
  DASHBOARD_HOME_RECENT_ORDER_SELECT,
  DASHBOARD_HOME_STORE_SELECT,
  DASHBOARD_HOME_TODAY_RECHARGE_SELECT,
  DASHBOARD_HOME_UPCOMING_ACCOUNT_SELECT,
  DASHBOARD_HOME_UPCOMING_LEAVE_SELECT,
  DASHBOARD_HOME_UPCOMING_RESERVATION_SELECT,
  type DailyRevenueRow,
  type DashboardHomeActivitiesData,
  type DashboardHomePeriodValue,
  type DashboardHomeStatsData,
  type DashboardHomeTrendRevenueRow,
  type InactiveVipRow,
  type LoadDashboardHomeActivitiesDataParams,
  type LoadDashboardHomeStatsDataParams,
  type LoadDashboardHomeTrendDataParams,
  type RecentOrderRow,
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
    prisma.$queryRaw<[{ revenue: Prisma.Decimal | null; order_count: bigint }]>`
      SELECT
        COALESCE(SUM(soi.sale_price * soi.quantity), 0) AS revenue,
        COUNT(DISTINCT so.id) AS order_count
      FROM sale_order_items soi
      INNER JOIN sale_orders so ON so.id = soi.order_id
      WHERE so.store_id = ${storeId}
        AND so.date >= ${new Date(currentRange.start)}
        AND so.date <= ${new Date(currentRange.end)}
        AND soi.product_name NOT IN ('预付抵扣', '续费抵扣')
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
        AND soi.product_name NOT IN ('预付抵扣', '续费抵扣')
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
      revenue: Number(currentSalesAgg[0]?.revenue ?? 0),
      orderCount: Number(currentSalesAgg[0]?.order_count ?? 0),
    },
    compareSales: {
      revenue: Number(compareSalesAgg[0]?.revenue ?? 0),
      orderCount: Number(compareSalesAgg[0]?.order_count ?? 0),
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

  const rows = await prisma.$queryRaw<DashboardHomeTrendRevenueRow[]>`
    SELECT
      date_trunc(${sqlGranularity}, so.date) AS "bucketAt",
      COALESCE(SUM(soi.sale_price * soi.quantity), 0) AS revenue
    FROM sale_order_items soi
    INNER JOIN sale_orders so ON so.id = soi.order_id
    WHERE so.store_id = ${params.storeId}
      AND so.date >= ${new Date(trendStart)}
      AND so.date <= ${new Date(params.currentRange.end)}
      AND soi.product_name NOT IN ('预付抵扣', '续费抵扣')
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
  const todayStart = getDayStartTimestamp(now);
  const todayEnd = getDayEndTimestamp(now);
  const upcomingLeaveEnd = getDayEndTimestamp(todayStart + DAY_MS * 3);
  const reservationWindowEnd =
    now + UPCOMING_RESERVATION_WITHIN_HOURS * 60 * 60 * 1000;
  const vipInactiveThreshold = new Date(
    now - VIP_INACTIVE_THRESHOLD_DAYS * DAY_MS,
  );
  const revenueLookbackStart = getDayStartTimestamp(
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
 * Prisma $queryRaw 返回的 date_trunc 结果是字符串而非 Date 对象，
 * 需要统一转换为 Date 以便后续 .getTime() / .getFullYear() 等调用。
 */
function normalizeRawBucketAt<T extends { bucketAt: Date | string }>(
  rows: T[],
): T[] {
  return rows.map((row) => ({
    ...row,
    bucketAt:
      row.bucketAt instanceof Date ? row.bucketAt : new Date(row.bucketAt),
  }));
}

/**
 * 加载近 N+1 天每日营收，用于检测连续下滑趋势。
 * 使用原始 SQL 以复用已有的 sale_order_items + sale_orders 聚合模式。
 */
async function loadRecentDailyRevenue(
  prisma: PrismaService,
  storeId: number,
  rangeStart: number,
  now: number,
): Promise<DailyRevenueRow[]> {
  const rows = await prisma.$queryRaw<DailyRevenueRow[]>`
    SELECT
      date_trunc('day', so.date) AS "bucketAt",
      COALESCE(SUM(soi.sale_price * soi.quantity), 0) AS revenue
    FROM sale_order_items soi
    INNER JOIN sale_orders so ON so.id = soi.order_id
    WHERE so.store_id = ${storeId}
      AND so.date >= ${new Date(rangeStart)}
      AND so.date <= ${new Date(now)}
      AND soi.product_name NOT IN ('预付抵扣', '续费抵扣')
    GROUP BY 1
    ORDER BY 1 ASC
  `;

  return normalizeRawBucketAt(rows);
}

/**
 * 生成近 DRAFT_PAYROLL_MAX_MONTHS_AGO 个月的月份过滤下界（月初零点 UTC）。
 * 用于只查近期未确认的工资单，避免把历史遗留草稿也拉出来。
 *
 * EmployeePayroll.month 已改为 DateTime 类型（存储每月 1 日的时间戳），
 * 因此这里返回 Date 而非 string，确保 Prisma where 条件类型匹配。
 */
function buildRecentPayrollMonthFilter(): Date {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() - DRAFT_PAYROLL_MAX_MONTHS_AGO;
  // 用 UTC 月初零点，与 employees-payroll.service.ts 中 normalizeMonthValue 保持一致
  return new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
}

/**
 * 加载最近订单，用于首页动态。
 * 优先取最近 2 小时内订单；若不足 RECENT_ORDER_MIN_COUNT 条，则补今日内最近订单，并去重。
 */
async function loadRecentOrders(
  prisma: PrismaService,
  storeId: number,
  todayStart: number,
  now: number,
): Promise<RecentOrderRow[]> {
  const windowStart = now - RECENT_ORDER_WINDOW_HOURS * 60 * 60 * 1000;

  // 1) 优先查最近 2 小时内的订单
  const recentOrders = await prisma.saleOrder.findMany({
    where: {
      storeId,
      createdAt: {
        gte: new Date(windowStart),
        lte: new Date(now),
      },
    },
    select: DASHBOARD_HOME_RECENT_ORDER_SELECT,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: MAX_RECENT_ORDER_COUNT,
  });

  if (recentOrders.length >= RECENT_ORDER_MIN_COUNT) {
    return recentOrders;
  }

  // 2) 2 小时内不足，补今日内最近订单，去重
  const existingIds = new Set(recentOrders.map((o) => o.id));
  const remaining = MAX_RECENT_ORDER_COUNT - recentOrders.length;

  const todayOrders = await prisma.saleOrder.findMany({
    where: {
      storeId,
      createdAt: {
        gte: new Date(todayStart),
        lte: new Date(now),
      },
      id: { notIn: [...existingIds] },
    },
    select: DASHBOARD_HOME_RECENT_ORDER_SELECT,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: remaining,
  });

  // 合并后按 createdAt 倒序
  const merged = [...recentOrders, ...todayOrders];
  merged.sort((a, b) => {
    const aTs = a.createdAt.getTime();
    const bTs = b.createdAt.getTime();
    if (bTs !== aTs) return bTs - aTs;
    return b.id - a.id;
  });

  return merged;
}

/**
 * 查询高价值会员久未到店列表（用于首页 dashboard 动态）
 *
 * level 和 lastConsumeAt 已从 Member 表删除，改从 MarketingCustomer 读取：
 * - level：由 mc.tier 映射（diamond→annual, gold→quarterly）
 * - lastConsumeAt：来自 mc.last_visit_at
 *
 * 高价值会员等级对应 MarketingCustomer.tier：
 * - annual → diamond
 * - quarterly → gold
 */
async function loadInactiveVips(
  prisma: PrismaService,
  storeId: number,
  vipInactiveThreshold: Date,
): Promise<InactiveVipRow[]> {
  return prisma.$queryRaw<InactiveVipRow[]>`
    SELECT
      m.id,
      m.name,
      CASE mc.tier::text
        WHEN 'diamond' THEN 'annual'
        WHEN 'gold'    THEN 'quarterly'
        ELSE NULL
      END AS "level",
      mc.last_visit_at AS "lastConsumeAt",
      m.updated_at AS "updatedAt"
    FROM members m
    JOIN marketing_customers mc ON mc.id = m.customer_id
      AND mc.deleted_at IS NULL
    WHERE m.store_id = ${storeId}
      AND m.status = 'active'::"MemberStatus"
      AND m.deleted_at IS NULL
      AND mc.tier IN ('diamond', 'gold')
      AND (
        mc.last_visit_at IS NULL
        OR mc.last_visit_at < ${vipInactiveThreshold}
      )
    ORDER BY mc.last_visit_at ASC NULLS FIRST, m.updated_at DESC
    LIMIT ${MAX_INACTIVE_VIP_COUNT}
  `;
}
