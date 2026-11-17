import {
  calcPercentChange,
  formatMonthDayLabel,
} from '../../commerce/commerce.utils';
import { Money } from '../../../shared/money.utils';
import { LEAVE_TYPE_LABELS, PERIOD_META } from './dashboard-home.constants';
import type {
  ActivityDraft,
  BuildDashboardHomeActivitiesParams,
} from './dashboard-home.types';
import {
  formatMoneyText,
  formatRelativeTime,
  formatSignedPercent,
  toTimestamp,
} from './dashboard-home.format-helpers';

/**
 * 首页动态的「核心指标」草稿：销售额环比、库存预警、逾期账款、进行中营销活动、
 * 待处理提现与员工休假。
 */

/** 销售额环比 + 库存预警 */
export function appendCoreSalesAndInventoryDrafts(
  drafts: ActivityDraft[],
  params: BuildDashboardHomeActivitiesParams,
  now: number,
): void {
  const periodMeta = PERIOD_META[params.period];
  const salesDiff = Money.fromInputYuan(params.currentSales.revenue)
    .subtract(Money.fromInputYuan(params.compareSales.revenue))
    .toOutputYuan();
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
}

/** 逾期账款 + 进行中的营销活动 */
export function appendCoreFinanceMarketingDrafts(
  drafts: ActivityDraft[],
  params: BuildDashboardHomeActivitiesParams,
  now: number,
): void {
  if (params.overdueAccounts.length > 0) {
    // remaining 数据库存储的是分（Int），需先转为元
    const totalRemaining = Money.sum(
      params.overdueAccounts.map((item) => Money.fromDbCents(item.remaining)),
    ).toOutputYuan();
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
}

/** 待处理提现 + 员工休假 */
export function appendCoreMemberEmployeeDrafts(
  drafts: ActivityDraft[],
  params: BuildDashboardHomeActivitiesParams,
  now: number,
): void {
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
      tag: `${formatMoneyText(Number(leave.days))}天`,
      bizType: 'employee_leave',
      bizId: String(leave.id),
      actionUrl: '/employee-management',
      createdAt: toTimestamp(leave.createdAt),
    });
  }
}
