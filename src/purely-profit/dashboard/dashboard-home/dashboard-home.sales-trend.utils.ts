import {
  addMoneyValues,
  formatMonthDayLabel,
  getDayStartTimestamp,
  roundMoneyValue,
  toDecimalNumber,
} from '../../commerce/commerce.utils';
import { toTimestamp } from './dashboard-home.activities.utils';
import {
  DAY_MS,
  TODAY_BUCKET_LABELS,
  YEAR_MONTH_LABELS,
} from './dashboard-home.constants';
import type {
  DashboardHomePeriodValue,
  DashboardHomeTrendRevenueRow,
  TimeRange,
} from './dashboard-home.types';
import type { DashboardHomeSalesTrendDto } from './dto/dashboard-home-response.dto';

export function buildDashboardHomeSalesTrend(
  period: DashboardHomePeriodValue,
  currentRange: TimeRange,
  trendRows: DashboardHomeTrendRevenueRow[],
): DashboardHomeSalesTrendDto {
  if (period === 'today') {
    return buildTodaySalesTrend(currentRange, trendRows);
  }

  if (period === 'week') {
    return buildRecentDaySalesTrend(7, currentRange.end, trendRows);
  }

  if (period === 'month') {
    return buildCurrentMonthSalesTrend(currentRange, trendRows);
  }

  return buildYearSalesTrend(period, trendRows);
}

function buildTodaySalesTrend(
  currentRange: TimeRange,
  trendRows: DashboardHomeTrendRevenueRow[],
): DashboardHomeSalesTrendDto {
  const todayStart = getDayStartTimestamp(currentRange.end);
  const actual: Array<number | null> = TODAY_BUCKET_LABELS.map(() => null);
  const forecast: Array<number | null> = TODAY_BUCKET_LABELS.map(() => null);

  for (const row of trendRows) {
    const timestamp = toTimestamp(row.bucketAt);
    if (timestamp < currentRange.start || timestamp > currentRange.end) {
      continue;
    }

    const bucketIndex = getTodayBucketIndex(timestamp);
    actual[bucketIndex] = addMoneyValues(
      actual[bucketIndex] ?? 0,
      toDecimalNumber(row.revenue),
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
    const average =
      realizedValues.reduce((sum, value) => sum + value, 0) /
      realizedValues.length;
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
  trendRows: DashboardHomeTrendRevenueRow[],
): DashboardHomeSalesTrendDto {
  const lastDayStart = getDayStartTimestamp(anchorTimestamp);
  const firstDayStart = lastDayStart - DAY_MS * (days - 1);
  const revenueMap = buildDailyRevenueMap(
    trendRows,
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
  trendRows: DashboardHomeTrendRevenueRow[],
): DashboardHomeSalesTrendDto {
  const revenueMap = buildDailyRevenueMap(
    trendRows,
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
  trendRows: DashboardHomeTrendRevenueRow[],
): DashboardHomeSalesTrendDto {
  const year =
    period === 'last_year'
      ? new Date().getFullYear() - 1
      : new Date().getFullYear();
  const revenueMap = new Map<number, number>();

  for (const row of trendRows) {
    const date = new Date(row.bucketAt);
    if (date.getFullYear() !== year) {
      continue;
    }

    const monthIndex = date.getMonth();
    revenueMap.set(
      monthIndex,
      addMoneyValues(
        revenueMap.get(monthIndex) ?? 0,
        toDecimalNumber(row.revenue),
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
  trendRows: DashboardHomeTrendRevenueRow[],
  start: number,
  end: number,
): Map<number, number> {
  const revenueMap = new Map<number, number>();

  for (const row of trendRows) {
    const timestamp = toTimestamp(row.bucketAt);
    if (timestamp < start || timestamp > end) {
      continue;
    }

    const dayStart = getDayStartTimestamp(timestamp);
    revenueMap.set(
      dayStart,
      addMoneyValues(
        revenueMap.get(dayStart) ?? 0,
        toDecimalNumber(row.revenue),
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
