import {
  addMoneyValues,
  calcPercentChange,
  formatMonthDayLabel,
  roundMoneyValue,
  subtractMoneyValues,
  toDecimalNumber,
} from '../../commerce/commerce.utils';
import {
  LEAVE_TYPE_LABELS,
  MAX_HOME_ACTIVITY_COUNT,
  PERIOD_META,
  REVENUE_DECLINE_CONSECUTIVE_DAYS,
  VIP_INACTIVE_THRESHOLD_DAYS,
} from './dashboard-home.constants';
import type {
  ActivityDraft,
  BuildDashboardHomeActivitiesParams,
} from './dashboard-home.types';
import type { DashboardHomeActivityDto } from './dto/dashboard-home-response.dto';

export function buildDashboardHomeActivities(
  params: BuildDashboardHomeActivitiesParams,
): DashboardHomeActivityDto[] {
  const drafts: ActivityDraft[] = [];
  const periodMeta = PERIOD_META[params.period];
  const now = Date.now();
  const salesDiff = subtractMoneyValues(
    params.currentSales.revenue,
    params.compareSales.revenue,
  );
  const salesChange = calcPercentChange(
    params.currentSales.revenue,
    params.compareSales.revenue,
  );

  if (salesDiff !== 0) {
    const isRise = salesDiff > 0;
    drafts.push({
      id: `sales-${params.period}`,
      type: isRise ? 'success' : 'info',
      icon: 'sales',
      title: `${periodMeta.displayLabel}销售额${isRise ? '超' : '低于'}${periodMeta.compareTarget}`,
      time:
        salesChange === null
          ? '刚刚 · 暂无对比数据'
          : `刚刚 · 环比 ${formatSignedPercent(salesChange)}`,
      value: `${salesDiff > 0 ? '+' : '-'}¥${formatMoneyText(Math.abs(salesDiff))}`,
      bizType: 'sales',
      actionUrl: '/sales-record',
      createdAt: now,
    });
  }

  const lowStockItems = params.lowStockProducts
    .filter((item) => item.stock <= item.alertThreshold)
    .slice(0, 2);
  for (const item of lowStockItems) {
    drafts.push({
      id: `inventory-${item.id}`,
      type: 'warning',
      icon: 'inventory',
      title: `${item.name} 库存预警`,
      time: `${formatRelativeTime(toTimestamp(item.updatedAt), now)} · 系统`,
      tag: `剩${item.stock}件`,
      bizType: 'inventory',
      bizId: String(item.id),
      actionUrl: '/stocktaking',
      createdAt: toTimestamp(item.updatedAt),
    });
  }

  if (params.overdueAccounts.length > 0) {
    const totalRemaining = params.overdueAccounts.reduce(
      (sum, item) => addMoneyValues(sum, toDecimalNumber(item.remaining)),
      0,
    );
    const latestOverdue = params.overdueAccounts[0];
    drafts.push({
      id: 'finance-overdue',
      type: 'warning',
      icon: 'finance',
      title: `有${params.overdueAccounts.length}笔账款已逾期`,
      time: `${formatRelativeTime(toTimestamp(latestOverdue.updatedAt), now)} · 财务管理`,
      tag: `¥${formatMoneyText(totalRemaining)}`,
      bizType: 'finance_account',
      bizId: String(latestOverdue.id),
      actionUrl: '/accounts-management',
      createdAt: toTimestamp(latestOverdue.updatedAt),
    });
  }

  if (params.activePromotions.length > 0) {
    const latestPromotion = params.activePromotions[0];
    drafts.push({
      id: 'marketing-active',
      type: 'info',
      icon: 'marketing',
      title: `当前有${params.activePromotions.length}个营销活动进行中`,
      time: `${formatRelativeTime(toTimestamp(latestPromotion.updatedAt), now)} · 营销中心`,
      tag: `至${formatMonthDayLabel(toTimestamp(latestPromotion.endAt))}`,
      bizType: 'marketing_promotion',
      bizId: String(latestPromotion.id),
      actionUrl: '/marketing-center',
      createdAt: toTimestamp(latestPromotion.updatedAt),
    });
  }

  if (params.pendingWithdrawals.length > 0) {
    const latestWithdrawal = params.pendingWithdrawals[0];
    const totalBeans = params.pendingWithdrawals.reduce(
      (sum, item) => sum + item.beanAmount,
      0,
    );
    drafts.push({
      id: 'withdrawal-pending',
      type: 'info',
      icon: 'withdrawal',
      title: `有${params.pendingWithdrawals.length}笔提现待处理`,
      time: `${formatRelativeTime(toTimestamp(latestWithdrawal.appliedAt), now)} · 会员中心`,
      tag: `待审${totalBeans}豆`,
      bizType: 'withdrawal',
      bizId: String(latestWithdrawal.id),
      actionUrl: '/member-center',
      createdAt: toTimestamp(latestWithdrawal.appliedAt),
    });
  }

  if (params.upcomingLeave) {
    const leave = params.upcomingLeave;
    drafts.push({
      id: `employee-leave-${leave.id}`,
      type: 'info',
      icon: 'employee',
      title: `${leave.employeeName}${LEAVE_TYPE_LABELS[leave.type]}即将开始`,
      time: `${formatRelativeTime(toTimestamp(leave.createdAt), now)} · 员工管理`,
      tag: `${formatMoneyText(toDecimalNumber(leave.days))}天`,
      bizType: 'employee_leave',
      bizId: String(leave.id),
      actionUrl: '/employee-management',
      createdAt: toTimestamp(leave.createdAt),
    });
  }

  // ---- 以下为新增 8 类动态 ----

  appendTodayNewMemberDraft(drafts, params, now);
  appendTodayRechargeDraft(drafts, params, now);
  appendUpcomingReservationDraft(drafts, params, now);
  appendUpcomingAccountDraft(drafts, params, now);
  appendDraftPayrollDraft(drafts, params, now);
  appendInactiveVipDraft(drafts, params, now);
  appendRevenueDeclineDraft(drafts, params, now);

  return drafts
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, MAX_HOME_ACTIVITY_COUNT);
}

/** 今日新增会员 */
function appendTodayNewMemberDraft(
  drafts: ActivityDraft[],
  params: BuildDashboardHomeActivitiesParams,
  now: number,
): void {
  if (params.todayNewMemberCount <= 0) {
    return;
  }

  drafts.push({
    id: 'member-today-new',
    type: 'success',
    icon: 'member',
    title: `今日新增${params.todayNewMemberCount}位会员`,
    time: '刚刚 · 会员中心',
    tag: `${params.todayNewMemberCount}人`,
    bizType: 'member_new',
    actionUrl: '/member-center',
    createdAt: now,
  });
}

/** 今日新增充值 */
function appendTodayRechargeDraft(
  drafts: ActivityDraft[],
  params: BuildDashboardHomeActivitiesParams,
  now: number,
): void {
  if (params.todayRecharges.length === 0) {
    return;
  }

  const totalAmount = params.todayRecharges.reduce(
    (sum, item) => sum + item.amount,
    0,
  );
  const latestRecharge = params.todayRecharges[0];

  drafts.push({
    id: 'member-today-recharge',
    type: 'success',
    icon: 'member',
    title: `今日新增${params.todayRecharges.length}笔充值`,
    time: `${formatRelativeTime(toTimestamp(latestRecharge.createdAt), now)} · 会员中心`,
    tag: `¥${formatMoneyText(totalAmount)}`,
    bizType: 'member_recharge',
    bizId: String(latestRecharge.id),
    actionUrl: '/member-center',
    createdAt: toTimestamp(latestRecharge.createdAt),
  });
}

/** 预约/包间即将开始 */
function appendUpcomingReservationDraft(
  drafts: ActivityDraft[],
  params: BuildDashboardHomeActivitiesParams,
  now: number,
): void {
  if (params.upcomingReservations.length === 0) {
    return;
  }

  const latestReservation = params.upcomingReservations[0];
  const remainingMinutes = Math.max(
    0,
    Math.floor((toTimestamp(latestReservation.reservedAt) - now) / 60_000),
  );

  drafts.push({
    id: `space-reservation-${latestReservation.id}`,
    type: 'info',
    icon: 'space',
    title: `${latestReservation.guestName}的预约即将开始`,
    time: `${remainingMinutes}分钟后 · 空间管理`,
    tag: `${params.upcomingReservations.length}个预约`,
    bizType: 'space_reservation',
    bizId: String(latestReservation.id),
    actionUrl: '/space-management',
    createdAt: toTimestamp(latestReservation.createdAt),
  });
}

/** 账款即将到期 */
function appendUpcomingAccountDraft(
  drafts: ActivityDraft[],
  params: BuildDashboardHomeActivitiesParams,
  now: number,
): void {
  if (params.upcomingAccounts.length === 0) {
    return;
  }

  const totalRemaining = params.upcomingAccounts.reduce(
    (sum, item) => addMoneyValues(sum, toDecimalNumber(item.remaining)),
    0,
  );
  const earliest = params.upcomingAccounts[0];

  drafts.push({
    id: 'finance-upcoming-due',
    type: 'warning',
    icon: 'finance',
    title: `有${params.upcomingAccounts.length}笔账款即将到期`,
    time: `${formatRelativeTime(toTimestamp(earliest.updatedAt), now)} · 财务管理`,
    tag: `¥${formatMoneyText(totalRemaining)}`,
    bizType: 'finance_account_upcoming',
    bizId: String(earliest.id),
    actionUrl: '/accounts-management',
    createdAt: toTimestamp(earliest.updatedAt),
  });
}

/** 工资单待确认 */
function appendDraftPayrollDraft(
  drafts: ActivityDraft[],
  params: BuildDashboardHomeActivitiesParams,
  now: number,
): void {
  if (params.draftPayrolls.length === 0) {
    return;
  }

  const latestDraft = params.draftPayrolls[0];
  const totalSalary = params.draftPayrolls.reduce(
    (sum, item) => addMoneyValues(sum, toDecimalNumber(item.actualSalary)),
    0,
  );

  drafts.push({
    id: 'employee-payroll-draft',
    type: 'warning',
    icon: 'employee',
    title: `有${params.draftPayrolls.length}份工资单待确认`,
    time: `${formatRelativeTime(toTimestamp(latestDraft.updatedAt), now)} · 员工管理`,
    tag: `¥${formatMoneyText(totalSalary)}`,
    bizType: 'employee_payroll',
    bizId: String(latestDraft.id),
    actionUrl: '/employee-management',
    createdAt: toTimestamp(latestDraft.updatedAt),
  });
}

/** 高价值会员久未到店 */
function appendInactiveVipDraft(
  drafts: ActivityDraft[],
  params: BuildDashboardHomeActivitiesParams,
  now: number,
): void {
  if (params.inactiveVips.length === 0) {
    return;
  }

  const latestInactive = params.inactiveVips[0];
  const inactiveDays = Math.floor(
    (now - toTimestamp(latestInactive.lastConsumeAt!)) / 86_400_000,
  );

  drafts.push({
    id: 'member-inactive-vip',
    type: 'info',
    icon: 'member',
    title: `有${params.inactiveVips.length}位高价值会员${VIP_INACTIVE_THRESHOLD_DAYS}天未到店`,
    time: `最近${inactiveDays}天 · 会员中心`,
    tag: `${params.inactiveVips.length}人`,
    bizType: 'member_inactive_vip',
    bizId: String(latestInactive.id),
    actionUrl: '/member-center',
    createdAt: toTimestamp(latestInactive.updatedAt),
  });
}

/** 营收连续下滑 */
function appendRevenueDeclineDraft(
  drafts: ActivityDraft[],
  params: BuildDashboardHomeActivitiesParams,
  now: number,
): void {
  const declineInfo = detectRevenueDecline(params.dailyRevenueRows, now);
  if (!declineInfo.isDeclining) {
    return;
  }

  drafts.push({
    id: 'sales-revenue-decline',
    type: 'warning',
    icon: 'sales',
    title: `营收连续${declineInfo.consecutiveDays}天下滑`,
    time: `近${REVENUE_DECLINE_CONSECUTIVE_DAYS}天 · 经营分析`,
    tag: `-${formatMoneyText(declineInfo.totalDeclineAmount)}`,
    bizType: 'revenue_decline',
    actionUrl: '/business-analysis',
    createdAt: now,
  });
}

/** 检测营收连续下滑趋势 */
function detectRevenueDecline(
  dailyRevenueRows: BuildDashboardHomeActivitiesParams['dailyRevenueRows'],
  now: number,
): {
  isDeclining: boolean;
  consecutiveDays: number;
  totalDeclineAmount: number;
} {
  if (dailyRevenueRows.length < 2) {
    return { isDeclining: false, consecutiveDays: 0, totalDeclineAmount: 0 };
  }

  const dayStartTs = (ts: number) => ts - (ts % 86_400_000);

  const todayDayStart = dayStartTs(now);
  const revenueByDay = new Map<number, number>();

  for (const row of dailyRevenueRows) {
    const dayTs = dayStartTs(toTimestamp(row.bucketAt));
    const revenue = Number(row.revenue);
    revenueByDay.set(dayTs, (revenueByDay.get(dayTs) ?? 0) + revenue);
  }

  let consecutiveDays = 0;
  let totalDeclineAmount = 0;
  let prevRevenue: number | null = null;

  for (let i = 0; i <= REVENUE_DECLINE_CONSECUTIVE_DAYS; i++) {
    const dayTs = todayDayStart - i * 86_400_000;
    const revenue = revenueByDay.get(dayTs);

    if (revenue === undefined) {
      if (prevRevenue !== null && prevRevenue > 0) {
        consecutiveDays++;
        totalDeclineAmount += prevRevenue;
      }
      prevRevenue = 0;
      continue;
    }

    if (prevRevenue !== null && revenue < prevRevenue) {
      consecutiveDays++;
      totalDeclineAmount += prevRevenue - revenue;
    } else {
      if (consecutiveDays >= REVENUE_DECLINE_CONSECUTIVE_DAYS) {
        break;
      }
      consecutiveDays = 0;
      totalDeclineAmount = 0;
    }

    prevRevenue = revenue;
  }

  return {
    isDeclining: consecutiveDays >= REVENUE_DECLINE_CONSECUTIVE_DAYS,
    consecutiveDays,
    totalDeclineAmount: roundMoneyValue(totalDeclineAmount),
  };
}

function formatMoneyText(value: number): string {
  return roundMoneyValue(value)
    .toFixed(2)
    .replace(/\.00$/, '')
    .replace(/(\.\d)0$/, '$1');
}

function formatSignedPercent(value: number): string {
  const formatted = formatMoneyText(Math.abs(value));
  return `${value > 0 ? '+' : '-'}${formatted}%`;
}

export function toTimestamp(value: Date | string | number): number {
  if (value instanceof Date) {
    return value.getTime();
  }
  return new Date(value).getTime();
}

function formatRelativeTime(timestamp: number, now: number): string {
  const diff = Math.max(now - timestamp, 0);
  const minute = 60 * 1000;
  const hour = 60 * minute;

  if (diff < minute) {
    return '刚刚';
  }

  if (diff < hour) {
    return `${Math.max(1, Math.floor(diff / minute))}分钟前`;
  }

  if (diff < 24 * hour) {
    return `${Math.max(1, Math.floor(diff / hour))}小时前`;
  }

  return 'today';
}
