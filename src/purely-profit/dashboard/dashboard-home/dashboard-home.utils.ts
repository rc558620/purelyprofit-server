import {
  addMoneyValues,
  calcPercentChange,
  formatMonthDayLabel,
  getDayStartTimestamp,
  getMonthStartTimestamp,
  getWeekStartTimestamp,
  roundMoneyValue,
  subtractMoneyValues,
  toDecimalNumber,
} from '../../commerce/commerce.utils';
import type { GetDashboardHomeOverviewQueryDto } from './dto/dashboard-home-query.dto';
import type {
  DashboardHomeActivityDto,
  DashboardHomeSalesTrendDto,
  DashboardHomeStatsDto,
} from './dto/dashboard-home-response.dto';
import {
  DAY_MS,
  LEAVE_TYPE_LABELS,
  MAX_HOME_ACTIVITY_COUNT,
  PERIOD_META,
  TODAY_BUCKET_LABELS,
  YEAR_MONTH_LABELS,
} from './dashboard-home.constants';
import type {
  ActivityDraft,
  AggregatedCostsResult,
  AggregatedSalesResult,
  BuildDashboardHomeActivitiesParams,
  DashboardHomePeriodValue,
  DashboardHomeQueryInput,
  SaleOrderRow,
  TimeRange,
} from './dashboard-home.types';

export function buildDashboardHomeQueryInput(
  queryDto: GetDashboardHomeOverviewQueryDto,
): DashboardHomeQueryInput {
  return {
    storeId: queryDto.storeId,
    period: queryDto.period,
  };
}

export function buildDashboardHomeStats(
  period: DashboardHomePeriodValue,
  currentSales: AggregatedSalesResult,
  compareSales: AggregatedSalesResult,
  currentCosts: AggregatedCostsResult,
  compareCosts: AggregatedCostsResult,
): DashboardHomeStatsDto {
  const meta = PERIOD_META[period];
  const currentProfit = subtractMoneyValues(
    currentSales.revenue,
    currentCosts.totalCost,
  );
  const compareProfit = subtractMoneyValues(
    compareSales.revenue,
    compareCosts.totalCost,
  );

  return {
    profitLabel: meta.profitLabel,
    profit: currentProfit,
      profitChange: calcPercentChange(currentProfit, compareProfit),

    profitCompareLabel: meta.compareLabel,
    orderLabel: meta.orderLabel,
    orderCount: currentSales.orderCount,
      orderChange: calcPercentChange(

      currentSales.orderCount,
      compareSales.orderCount,
    ),
    orderCompareLabel: meta.compareLabel,
  };
}

export function buildDashboardHomeSalesTrend(
  period: DashboardHomePeriodValue,
  currentRange: TimeRange,
  saleOrders: SaleOrderRow[],
): DashboardHomeSalesTrendDto {
  if (period === 'today') {
    return buildTodaySalesTrend(currentRange, saleOrders);
  }

  if (period === 'week') {
    return buildRecentDaySalesTrend(7, currentRange.end, saleOrders);
  }

  if (period === 'month') {
    return buildCurrentMonthSalesTrend(currentRange, saleOrders);
  }

  return buildYearSalesTrend(period, saleOrders);
}

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
      time: `${formatRelativeTime(item.updatedAt.getTime(), now)} · 系统`,
      tag: `剩${item.stock}件`,
      bizType: 'inventory',
      bizId: String(item.id),
      actionUrl: '/stocktaking',
      createdAt: item.updatedAt.getTime(),
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
      time: `${formatRelativeTime(latestOverdue.updatedAt.getTime(), now)} · 财务管理`,
      tag: `¥${formatMoneyText(totalRemaining)}`,
      bizType: 'finance_account',
      bizId: String(latestOverdue.id),
      actionUrl: '/accounts-management',
      createdAt: latestOverdue.updatedAt.getTime(),
    });
  }

  if (params.activePromotions.length > 0) {
    const latestPromotion = params.activePromotions[0];
    drafts.push({
      id: 'marketing-active',
      type: 'info',
      icon: 'marketing',
      title: `当前有${params.activePromotions.length}个营销活动进行中`,
      time: `${formatRelativeTime(latestPromotion.updatedAt.getTime(), now)} · 营销中心`,
      tag: `至${formatMonthDayLabel(latestPromotion.endAt.getTime())}`,
      bizType: 'marketing_promotion',
      bizId: String(latestPromotion.id),
      actionUrl: '/marketing-center',
      createdAt: latestPromotion.updatedAt.getTime(),
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
      time: `${formatRelativeTime(latestWithdrawal.appliedAt.getTime(), now)} · 会员中心`,
      tag: `待审${totalBeans}豆`,
      bizType: 'withdrawal',
      bizId: String(latestWithdrawal.id),
      actionUrl: '/member-center',
      createdAt: latestWithdrawal.appliedAt.getTime(),
    });
  }

  if (params.upcomingLeave) {
    const leave = params.upcomingLeave;
    drafts.push({
      id: `employee-leave-${leave.id}`,
      type: 'info',
      icon: 'employee',
      title: `${leave.employeeName}${LEAVE_TYPE_LABELS[leave.type]}即将开始`,
      time: `${formatRelativeTime(leave.createdAt.getTime(), now)} · 员工管理`,
      tag: `${formatMoneyText(toDecimalNumber(leave.days))}天`,
      bizType: 'employee_leave',
      bizId: String(leave.id),
      actionUrl: '/employee-management',
      createdAt: leave.createdAt.getTime(),
    });
  }

  return drafts
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, MAX_HOME_ACTIVITY_COUNT);
}

export function buildCurrentRange(period: DashboardHomePeriodValue): TimeRange {
  const now = Date.now();
  const currentDate = new Date(now);

  switch (period) {
    case 'today':
      return {
        start: getDayStartTimestamp(now),
        end: now,
      };
    case 'week':
      return {
        start: getWeekStartTimestamp(now),
        end: now,
      };
    case 'month':
      return {
        start: getMonthStartTimestamp(now),
        end: now,
      };
    case 'year':
      return {
        start: new Date(currentDate.getFullYear(), 0, 1).getTime(),
        end: now,
      };
    case 'last_year': {
      const year = currentDate.getFullYear() - 1;
      return {
        start: new Date(year, 0, 1).getTime(),
        end: new Date(year, 11, 31, 23, 59, 59, 999).getTime(),
      };
    }
  }
}

export function buildCompareRange(
  period: DashboardHomePeriodValue,
  currentRange: TimeRange,
): TimeRange {
  const currentDuration = currentRange.end - currentRange.start;

  switch (period) {
    case 'today': {
      const start = currentRange.start - DAY_MS;
      return {
        start,
        end: start + currentDuration,
      };
    }
    case 'week': {
      const start = currentRange.start - DAY_MS * 7;
      return {
        start,
        end: start + currentDuration,
      };
    }
    case 'month': {
      const currentStartDate = new Date(currentRange.start);
      const previousMonthStart = new Date(
        currentStartDate.getFullYear(),
        currentStartDate.getMonth() - 1,
        1,
      );
      const previousMonthEnd = new Date(
        currentStartDate.getFullYear(),
        currentStartDate.getMonth(),
        0,
        23,
        59,
        59,
        999,
      );
      return {
        start: previousMonthStart.getTime(),
        end: Math.min(
          previousMonthStart.getTime() + currentDuration,
          previousMonthEnd.getTime(),
        ),
      };
    }
    case 'year': {
      const currentStartDate = new Date(currentRange.start);
      const previousYearStart = new Date(
        currentStartDate.getFullYear() - 1,
        0,
        1,
      );
      const previousYearEnd = new Date(
        currentStartDate.getFullYear() - 1,
        11,
        31,
        23,
        59,
        59,
        999,
      );
      return {
        start: previousYearStart.getTime(),
        end: Math.min(
          previousYearStart.getTime() + currentDuration,
          previousYearEnd.getTime(),
        ),
      };
    }
    case 'last_year': {
      const currentYear = new Date(currentRange.start).getFullYear();
      const compareYear = currentYear - 1;
      return {
        start: new Date(compareYear, 0, 1).getTime(),
        end: new Date(compareYear, 11, 31, 23, 59, 59, 999).getTime(),
      };
    }
  }
}

function buildTodaySalesTrend(
  currentRange: TimeRange,
  saleOrders: SaleOrderRow[],
): DashboardHomeSalesTrendDto {
  const todayStart = getDayStartTimestamp(currentRange.end);
  const actual: Array<number | null> = TODAY_BUCKET_LABELS.map(() => null);
  const forecast: Array<number | null> = TODAY_BUCKET_LABELS.map(() => null);

  for (const row of saleOrders) {
    const timestamp = row.date.getTime();
    if (timestamp < currentRange.start || timestamp > currentRange.end) {
      continue;
    }

    const bucketIndex = getTodayBucketIndex(timestamp);
    actual[bucketIndex] = addMoneyValues(
      actual[bucketIndex] ?? 0,
      toDecimalNumber(row.totalRevenue),
    );
  }

  const now = currentRange.end;
  let firstFutureBucketIndex: number | null = null;
  const realizedValues: number[] = [];

  TODAY_BUCKET_LABELS.forEach((label, index) => {
    const bucketTime = buildTodayBucketTimestamp(todayStart, label);
    if (bucketTime <= now) {
      actual[index] ??= 0;
      realizedValues.push(actual[index] ?? 0);
      return;
    }

    if (firstFutureBucketIndex === null) {
      firstFutureBucketIndex = index;
    }
    actual[index] = null;
  });

  if (firstFutureBucketIndex !== null && realizedValues.length > 0) {
    const average = realizedValues.reduce((sum, value) => sum + value, 0)
      / realizedValues.length;
    if (average > 0) {
      forecast[firstFutureBucketIndex] = roundMoneyValue(average);
    }
  }

  return {
    title: '销售趋势图',
    categories: [...TODAY_BUCKET_LABELS],
    actual,
    forecast,
    isYearMode: false,
    seriesNameActual: '实收',
    seriesNameForecast: '预测',
  };
}

function buildRecentDaySalesTrend(
  days: number,
  anchorTimestamp: number,
  saleOrders: SaleOrderRow[],
): DashboardHomeSalesTrendDto {
  const lastDayStart = getDayStartTimestamp(anchorTimestamp);
  const firstDayStart = lastDayStart - DAY_MS * (days - 1);
  const revenueMap = buildDailyRevenueMap(
    saleOrders,
    firstDayStart,
    anchorTimestamp,
  );

  const categories: string[] = [];
  const actual: Array<number | null> = [];

  for (let index = 0; index < days; index += 1) {
    const currentDayStart = firstDayStart + DAY_MS * index;
    categories.push(formatMonthDayLabel(currentDayStart));
    actual.push(revenueMap.get(currentDayStart) ?? 0);
  }

  return {
    title: '销售趋势图',
    categories,
    actual,
    forecast: Array.from({ length: actual.length }, () => null),
    isYearMode: false,
    seriesNameActual: '实收',
    seriesNameForecast: '预测',
  };
}

function buildCurrentMonthSalesTrend(
  currentRange: TimeRange,
  saleOrders: SaleOrderRow[],
): DashboardHomeSalesTrendDto {
  const revenueMap = buildDailyRevenueMap(
    saleOrders,
    currentRange.start,
    currentRange.end,
  );
  const categories: string[] = [];
  const actual: Array<number | null> = [];
  const lastDayStart = getDayStartTimestamp(currentRange.end);

  for (
    let dayStart = currentRange.start;
    dayStart <= lastDayStart;
    dayStart += DAY_MS
  ) {
    categories.push(formatMonthDayLabel(dayStart));
    actual.push(revenueMap.get(dayStart) ?? 0);
  }

  return {
    title: '销售趋势图',
    categories,
    actual,
    forecast: Array.from({ length: actual.length }, () => null),
    isYearMode: false,
    seriesNameActual: '实收',
    seriesNameForecast: '预测',
  };
}

function buildYearSalesTrend(
  period: DashboardHomePeriodValue,
  saleOrders: SaleOrderRow[],
): DashboardHomeSalesTrendDto {
  const year =
    period === 'last_year' ? new Date().getFullYear() - 1 : new Date().getFullYear();
  const revenueMap = new Map<number, number>();

  for (const row of saleOrders) {
    const date = row.date;
    if (date.getFullYear() !== year) {
      continue;
    }

    const monthIndex = date.getMonth();
    revenueMap.set(
      monthIndex,
      addMoneyValues(
        revenueMap.get(monthIndex) ?? 0,
        toDecimalNumber(row.totalRevenue),
      ),
    );
  }

  return {
    title: '销售趋势图',
    categories: [...YEAR_MONTH_LABELS],
    actual: YEAR_MONTH_LABELS.map(
      (_label, index) => revenueMap.get(index) ?? 0,
    ),
    forecast: YEAR_MONTH_LABELS.map(() => null),
    isYearMode: true,
    seriesNameActual: '实收',
    seriesNameForecast: '预测',
  };
}

function buildDailyRevenueMap(
  saleOrders: SaleOrderRow[],
  start: number,
  end: number,
): Map<number, number> {
  const revenueMap = new Map<number, number>();

  for (const row of saleOrders) {
    const timestamp = row.date.getTime();
    if (timestamp < start || timestamp > end) {
      continue;
    }

    const dayStart = getDayStartTimestamp(timestamp);
    revenueMap.set(
      dayStart,
      addMoneyValues(
        revenueMap.get(dayStart) ?? 0,
        toDecimalNumber(row.totalRevenue),
      ),
    );
  }

  return revenueMap;
}

function getTodayBucketIndex(timestamp: number): number {
  const date = new Date(timestamp);
  const hour = date.getHours();
  if (hour < 10) return 0;
  if (hour < 12) return 1;
  if (hour < 14) return 2;
  if (hour < 16) return 3;
  if (hour < 18) return 4;
  if (hour < 20) return 5;
  if (hour < 22) return 6;
  return 7;
}

function buildTodayBucketTimestamp(dayStart: number, label: string): number {
  const [hourText, minuteText] = label.split(':');
  const hour = Number.parseInt(hourText ?? '0', 10);
  const minute = Number.parseInt(minuteText ?? '0', 10);
  return dayStart + hour * 60 * 60 * 1000 + minute * 60 * 1000;
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
