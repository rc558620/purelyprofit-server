import { EmployeePayrollStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  getShanghaiMonth,
  getShanghaiYear,
} from '../../../shared/shanghai-time.utils';
import {
  buildDerivedFinanceAccountStatusWhere,
  buildUpcomingDueAccountWhere,
} from '../../finance/finance-account.query';
import { CUSTODY_EXPIRING_SOON_DAYS } from '../../operations/custody/custody.constants';
import {
  DAY_MS,
  DRAFT_PAYROLL_MAX_MONTHS_AGO,
  MAX_DRAFT_PAYROLL_COUNT,
  UPCOMING_ACCOUNT_DUE_WITHIN_DAYS,
} from './dashboard-home.constants';
import {
  DASHBOARD_HOME_ACTIVE_PROMOTION_SELECT,
  DASHBOARD_HOME_CUSTODY_EXPIRING_SELECT,
  DASHBOARD_HOME_DRAFT_PAYROLL_SELECT,
  DASHBOARD_HOME_OVERDUE_ACCOUNT_SELECT,
  DASHBOARD_HOME_PENDING_WITHDRAWAL_SELECT,
  DASHBOARD_HOME_PRODUCT_ALERT_SELECT,
  DASHBOARD_HOME_UPCOMING_ACCOUNT_SELECT,
  DASHBOARD_HOME_UPCOMING_LEAVE_SELECT,
  type DashboardHomeActivitiesStableChunk,
  type LoadDashboardHomeActivitiesDataParams,
} from './dashboard-home.types';
import {
  loadInactiveVips,
  resolveActivitiesTimeWindows,
  type DashboardHomeActivitiesTimeWindows,
} from './dashboard-home.activities.query';

interface ActivitiesChunkParams {
  storeId: number;
  now: number;
}

interface OperationalAlertsParams extends ActivitiesChunkParams {
  windows: DashboardHomeActivitiesTimeWindows;
}

/**
 * 经营预警：库存不足、客存到期、高价值会员流失、员工请假。
 *
 * 这四类都不是「当天实时」数据，5 分钟缓存已足够，放进状态块避免跟着
 * 今日充值 / 今日订单一起被 45s 刷新。
 */
async function loadStockAndCustodyAlerts(
  prisma: PrismaService,
  params: OperationalAlertsParams,
): Promise<
  Pick<
    DashboardHomeActivitiesStableChunk,
    'lowStockProducts' | 'expiringCustodies' | 'inactiveVips' | 'upcomingLeaves'
  >
> {
  const { storeId, now, windows } = params;
  const [lowStockProducts, expiringCustodies, inactiveVips, upcomingLeaves] =
    await Promise.all([
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
      // 客存到期预警：在存且临期阈值内到期（含已到期），按到期时间升序取最早到期的几笔
      prisma.custodyOrder.findMany({
        where: {
          storeId,
          deletedAt: null,
          status: 'stored',
          expireAt: {
            not: null,
            lte: new Date(now + CUSTODY_EXPIRING_SOON_DAYS * DAY_MS),
          },
        },
        select: DASHBOARD_HOME_CUSTODY_EXPIRING_SELECT,
        orderBy: [{ expireAt: 'asc' }, { id: 'desc' }],
        take: 5,
      }),
      loadInactiveVips(prisma, storeId, windows.vipInactiveThreshold),
      prisma.employeeLeave.findMany({
        where: {
          storeId,
          startDate: {
            gte: new Date(windows.todayStart),
            lte: new Date(windows.upcomingLeaveEnd),
          },
        },
        select: DASHBOARD_HOME_UPCOMING_LEAVE_SELECT,
        orderBy: [{ startDate: 'asc' }, { createdAt: 'desc' }],
        take: 1,
      }),
    ]);

  return { lowStockProducts, expiringCustodies, inactiveVips, upcomingLeaves };
}

/** 账款预警：已逾期与即将到期，两者共用 finance_account_records 索引 */
async function loadFinanceDueAlerts(
  prisma: PrismaService,
  params: ActivitiesChunkParams,
): Promise<
  Pick<
    DashboardHomeActivitiesStableChunk,
    'overdueAccounts' | 'upcomingAccounts'
  >
> {
  const { storeId, now } = params;
  const [overdueAccounts, upcomingAccounts] = await Promise.all([
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
  ]);

  return { overdueAccounts, upcomingAccounts };
}

/** 待处理事项：进行中促销、待确认提现、待确认工资单 */
async function loadPendingTodoAlerts(
  prisma: PrismaService,
  params: ActivitiesChunkParams,
): Promise<
  Pick<
    DashboardHomeActivitiesStableChunk,
    'activePromotions' | 'pendingWithdrawals' | 'draftPayrolls'
  >
> {
  const { storeId, now } = params;
  const [activePromotions, pendingWithdrawals, draftPayrolls] =
    await Promise.all([
      prisma.marketingPromotion.findMany({
        where: {
          storeId,
          enabled: true,
          startAt: { lte: new Date(now) },
          endAt: { gte: new Date(now) },
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
      prisma.employeePayroll.findMany({
        where: {
          storeId,
          status: EmployeePayrollStatus.draft,
          month: {
            gte: buildRecentPayrollMonthFilter(now),
          },
        },
        select: DASHBOARD_HOME_DRAFT_PAYROLL_SELECT,
        orderBy: [{ month: 'desc' }, { updatedAt: 'desc' }],
        take: MAX_DRAFT_PAYROLL_COUNT,
      }),
    ]);

  return { activePromotions, pendingWithdrawals, draftPayrolls };
}

/**
 * 状态块：与「今天」无关的业务状态，分钟级变化，用较长 TTL 独立缓存。
 * 内部再按领域拆三组查询，单函数保持在可维护长度。
 */
export async function loadDashboardHomeActivitiesStableChunk(
  prisma: PrismaService,
  params: LoadDashboardHomeActivitiesDataParams,
): Promise<DashboardHomeActivitiesStableChunk> {
  const { storeId, now } = params;
  const windows = resolveActivitiesTimeWindows(now);
  const [stockAndCustody, financeDue, pendingTodo] = await Promise.all([
    loadStockAndCustodyAlerts(prisma, { storeId, now, windows }),
    loadFinanceDueAlerts(prisma, { storeId, now }),
    loadPendingTodoAlerts(prisma, { storeId, now }),
  ]);

  return { ...stockAndCustody, ...financeDue, ...pendingTodo };
}

/**
 * 生成近 DRAFT_PAYROLL_MAX_MONTHS_AGO 个月的月份过滤下界（月初零点 UTC）。
 * 用于只查近期未确认的工资单，避免把历史遗留草稿也拉出来。
 *
 * EmployeePayroll.month 已改为 DateTime 类型（存储每月 1 日的时间戳），
 * 因此这里返回 Date 而非 string，确保 Prisma where 条件类型匹配。
 */
function buildRecentPayrollMonthFilter(nowMs: number): Date {
  // 「当前月份」按上海时区判定，避免 UTC 下月初/月末误判
  const year = getShanghaiYear(nowMs);
  const month = getShanghaiMonth(nowMs) - DRAFT_PAYROLL_MAX_MONTHS_AGO;
  // 用 UTC 月初零点，与 employees-payroll.service.ts 中 normalizeMonthValue 保持一致
  return new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
}
