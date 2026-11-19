import { formatMonthDayLabel } from '../../commerce/commerce.utils';
import { Money } from '../../../shared/money.utils';
import { formatShanghaiTime } from '../../../shared/shanghai-time.utils';
import { resolveTimestamp } from '../../../shared/date-coerce.utils';
import {
  REVENUE_DECLINE_CONSECUTIVE_DAYS,
  VIP_INACTIVE_THRESHOLD_DAYS,
} from './dashboard-home.constants';
import type {
  ActivityDraft,
  BuildDashboardHomeActivitiesParams,
} from './dashboard-home.types';
import {
  formatMoneyText,
  formatRelativeTime,
  toTimestamp,
} from './dashboard-home.format-helpers';
import { detectRevenueDecline } from './dashboard-home.revenue-decline';

/**
 * 首页动态草稿生成器集合。
 *
 * 从 `dashboard-home.activities.utils` 抽离：编排函数只负责按顺序收集，
 * 每一类动态的取值 / 文案 / 跳转在这里各自成函数，便于单独阅读与新增。
 */

/** 今日新增会员 */
export function appendTodayNewMemberDraft(
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
export function appendTodayRechargeDraft(
  drafts: ActivityDraft[],
  params: BuildDashboardHomeActivitiesParams,
  now: number,
): void {
  if (params.todayRecharges.length === 0) {
    return;
  }

  const totalAmount = Money.sum(
    params.todayRecharges.map((item) => Money.fromDbCents(item.amount)),
  ).toOutputYuan();
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
export function appendUpcomingReservationDraft(
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
export function appendUpcomingAccountDraft(
  drafts: ActivityDraft[],
  params: BuildDashboardHomeActivitiesParams,
  now: number,
): void {
  if (params.upcomingAccounts.length === 0) {
    return;
  }

  // remaining 数据库存储的是分（Int），需先转为元
  const totalRemaining = Money.sum(
    params.upcomingAccounts.map((item) => Money.fromDbCents(item.remaining)),
  ).toOutputYuan();
  const earliest = params.upcomingAccounts[0];

  drafts.push({
    id: 'finance-upcoming-due',
    type: 'warning',
    icon: 'finance',
    // 只取最近 5 笔，避免把「前 5 笔」写成全量
    title: `近期${params.upcomingAccounts.length}笔账款即将到期`,
    time: `${formatRelativeTime(toTimestamp(earliest.updatedAt), now)} · 财务管理`,
    tag: `¥${formatMoneyText(totalRemaining)}`,
    bizType: 'finance_account_upcoming',
    bizId: String(earliest.id),
    actionUrl: '/accounts-management',
    createdAt: toTimestamp(earliest.updatedAt),
  });
}

/** 工资单待确认 */
export function appendDraftPayrollDraft(
  drafts: ActivityDraft[],
  params: BuildDashboardHomeActivitiesParams,
  now: number,
): void {
  if (params.draftPayrolls.length === 0) {
    return;
  }

  const latestDraft = params.draftPayrolls[0];
  const totalSalary = Money.sum(
    params.draftPayrolls.map((item) => Money.fromDbCents(item.actualSalary)),
  ).toOutputYuan();

  drafts.push({
    id: 'employee-payroll-draft',
    type: 'warning',
    icon: 'employee',
    // 只取最近 5 份，避免把「前 5 份」写成全量
    title: `近期${params.draftPayrolls.length}份工资单待确认`,
    time: `${formatRelativeTime(toTimestamp(latestDraft.updatedAt), now)} · 员工管理`,
    tag: `¥${formatMoneyText(totalSalary)}`,
    bizType: 'employee_payroll',
    bizId: String(latestDraft.id),
    actionUrl: '/employee-management',
    createdAt: toTimestamp(latestDraft.updatedAt),
  });
}

/** 高价值会员久未到店 */
export function appendInactiveVipDraft(
  drafts: ActivityDraft[],
  params: BuildDashboardHomeActivitiesParams,
  now: number,
): void {
  if (params.inactiveVips.length === 0) {
    return;
  }

  const latestInactive = params.inactiveVips[0];
  const lastConsumeTs = latestInactive.lastConsumeAt
    ? toTimestamp(latestInactive.lastConsumeAt)
    : now - VIP_INACTIVE_THRESHOLD_DAYS * 86_400_000;
  const inactiveDays = Math.floor((now - lastConsumeTs) / 86_400_000);

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

/** 客存到期预警：临期阈值内到期（含已到期）的在存存单，聚合为一条预警动态 */
export function appendCustodyExpiringDraft(
  drafts: ActivityDraft[],
  params: BuildDashboardHomeActivitiesParams,
  now: number,
): void {
  if (params.expiringCustodies.length === 0) {
    return;
  }

  /*
   * 活动数据经 Redis JSON 反序列化后，日期字段回读为字符串而非 Date：
   * 所有时间比较与展示统一走 toTimestamp，禁止直接调 .getTime()。
   */
  // 查询按 expireAt 升序返回，首条即最早到期；已到期单用「已含」口径提示
  const earliest = params.expiringCustodies[0]!;
  // 查询条件已保证 expireAt 非空，缺失时回落更新时间，时间戳非法时回落 now
  const earliestExpireAt = resolveTimestamp(
    earliest.expireAt ?? earliest.updatedAt,
    now,
  );
  const expiredCount = params.expiringCustodies.filter(
    (item) =>
      item.expireAt != null && resolveTimestamp(item.expireAt, now) <= now,
  ).length;
  const title =
    expiredCount > 0
      ? `有${params.expiringCustodies.length}笔客存到期预警`
      : `有${params.expiringCustodies.length}笔客存即将到期`;

  drafts.push({
    id: 'custody-expiring',
    type: 'warning',
    icon: 'inventory',
    title,
    time: `${formatRelativeTime(resolveTimestamp(earliest.updatedAt, now), now)} · 客存管理`,
    tag: `${formatMonthDayLabel(earliestExpireAt)}到期`,
    bizType: 'custody_expiring',
    bizId: String(earliest.id),
    actionUrl: '/custody-management',
    createdAt: earliestExpireAt,
  });
}

/** 营收连续下滑 */
export function appendRevenueDeclineDraft(
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

/** 最近订单动态 */
export function appendRecentOrderDrafts(
  drafts: ActivityDraft[],
  params: BuildDashboardHomeActivitiesParams,
  _now: number,
): void {
  if (!params.recentOrders || params.recentOrders.length === 0) {
    return;
  }

  for (const order of params.recentOrders) {
    // totalRevenue 数据库存储的是分（Int），需先转为元
    const revenue = Money.fromDbCents(order.totalRevenue ?? 0).toOutputYuan();
    if (revenue <= 0) {
      continue;
    }

    const orderDate = new Date(order.date);
    const [hours, minutes] = formatShanghaiTime(orderDate.getTime()).split(':');
    const valueText = `+¥${formatMoneyText(revenue)}`;

    drafts.push({
      id: `sales-order-${order.id}`,
      type: 'success',
      icon: 'sales',
      title: '订单完成',
      time: `${hours}:${minutes} · 销售记录`,
      value: valueText,
      bizType: 'sales_order',
      bizId: String(order.id),
      actionUrl: '/sales-record',
      createdAt: toTimestamp(order.createdAt),
    });
  }
}
