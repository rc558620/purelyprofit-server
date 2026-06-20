import {
  REVENUE_FALLBACK_LABEL,
  REVENUE_LIFETIME_LABEL,
  REVENUE_MONTHLY_LABEL,
  REVENUE_QUARTERLY_LABEL,
  REVENUE_TYPE_LABELS,
  REVENUE_YEARLY_LABEL,
} from './dashboard.constants';
import type {
  DashboardRevenueOrderRow,
  DashboardRevenueTypeCountRow,
  DashboardRevenueTypeLabelRow,
} from './dashboard.types';
import type { PulseHomeRevenuePeriodValue } from './dto/pulse-dashboard-query.dto';
import { formatDateLabel } from './dashboard-time.utils';

export function mapRevenuePlanLabel(
  planId: string,
  planName?: string | null,
): string {
  if (planId === 'monthly') {
    return REVENUE_MONTHLY_LABEL;
  }
  if (planId === 'quarterly') {
    return REVENUE_QUARTERLY_LABEL;
  }
  if (planId === 'yearly' || planId === 'annual') {
    return REVENUE_YEARLY_LABEL;
  }
  if (planId === 'lifetime') {
    return REVENUE_LIFETIME_LABEL;
  }
  if (planName?.includes('月')) {
    return REVENUE_MONTHLY_LABEL;
  }
  if (planName?.includes('季')) {
    return REVENUE_QUARTERLY_LABEL;
  }
  if (planName?.includes('年')) {
    return REVENUE_YEARLY_LABEL;
  }
  if (planName?.includes('永久') || planName?.includes('终身')) {
    return REVENUE_LIFETIME_LABEL;
  }

  return REVENUE_FALLBACK_LABEL;
}

export function buildRevenueTypeDistribution(
  rows: DashboardRevenueTypeLabelRow[],
): Array<{ label: string; value: number }> {
  if (rows.length === 0) {
    return REVENUE_TYPE_LABELS.map((label) => ({ label, value: 0 }));
  }

  const countMap = new Map<string, number>();
  for (const row of rows) {
    countMap.set(row.typeLabel, (countMap.get(row.typeLabel) ?? 0) + 1);
  }

  return mapRevenueTypeDistributionByCountMap(countMap, rows.length);
}

export function buildRevenueTypeDistributionFromPlanCounts(
  rows: DashboardRevenueTypeCountRow[],
): Array<{ label: string; value: number }> {
  if (rows.length === 0) {
    return REVENUE_TYPE_LABELS.map((label) => ({ label, value: 0 }));
  }

  const countMap = new Map<string, number>();
  let totalCount = 0;

  for (const row of rows) {
    const typeLabel = mapRevenuePlanLabel(row.planId);
    countMap.set(typeLabel, (countMap.get(typeLabel) ?? 0) + row.count);
    totalCount += row.count;
  }

  return mapRevenueTypeDistributionByCountMap(countMap, totalCount);
}

export function buildRevenueTrend(
  orders: DashboardRevenueOrderRow[],
  displayPeriod: PulseHomeRevenuePeriodValue,
  amountMapper: (amount: number) => number = (amount) => amount,
): { dates: string[]; values: number[] } {
  // 使用 label → { total, firstDate } 的聚合结构，
  // firstDate 保留原始 Date 用于排序，避免跨年时纯字符串比较错误
  const bucketMap = new Map<string, { total: number; firstDate: Date }>();

  for (const order of orders) {
    const key =
      displayPeriod === 'today'
        ? `${String(order.createdAt.getHours()).padStart(2, '0')}:00`
        : formatDateLabel(order.createdAt);
    const existing = bucketMap.get(key);
    if (existing) {
      existing.total += order.amount;
    } else {
      bucketMap.set(key, { total: order.amount, firstDate: order.createdAt });
    }
  }

  const sortedEntries = Array.from(bucketMap.entries()).sort(
    (left, right) => left[1].firstDate.getTime() - right[1].firstDate.getTime(),
  );

  return {
    dates: sortedEntries.map(([date]) => date),
    values: sortedEntries.map(([, { total }]) => amountMapper(total)),
  };
}

export function calcRevenuePeakAmount(
  orders: DashboardRevenueOrderRow[],
  amountMapper: (amount: number) => number = (amount) => amount,
): number {
  const dailyTotals = new Map<string, number>();
  for (const order of orders) {
    const key = formatDateLabel(order.createdAt);
    dailyTotals.set(key, (dailyTotals.get(key) ?? 0) + order.amount);
  }

  return amountMapper(Math.max(0, ...dailyTotals.values()));
}

export function formatHourMinute(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(
    date.getMinutes(),
  ).padStart(2, '0')}`;
}

export function normalizeRegionValues(region: unknown): string[] {
  if (!Array.isArray(region)) {
    return [];
  }

  return region
    .filter(
      (item): item is string | number =>
        typeof item === 'string' || typeof item === 'number',
    )
    .map((item) => String(item).trim())
    .filter(Boolean);
}

function mapRevenueTypeDistributionByCountMap(
  countMap: Map<string, number>,
  totalCount: number,
): Array<{ label: string; value: number }> {
  return REVENUE_TYPE_LABELS.map((label) => ({
    label,
    value:
      totalCount > 0
        ? Math.round(((countMap.get(label) ?? 0) / totalCount) * 100)
        : 0,
  }));
}
