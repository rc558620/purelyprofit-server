import Decimal from 'decimal.js';
import {
  DASHBOARD_TREND_TODAY_BUCKET_HOURS,
  DASHBOARD_TREND_TODAY_BUCKET_LABELS,
  DASHBOARD_TREND_YEAR_MONTH_LABELS,
} from './dashboard.constants';
import { formatDateLabel, type TimeRange } from './dashboard-time.utils';
import type { DashboardTrendSaleRow } from './dashboard.types';
import type { PulseDashboardPeriodValue } from './dto/pulse-dashboard-query.dto';
import type { PulseDashboardSalesTrendDto } from './dto/pulse-dashboard-response.dto';

export function buildDashboardSalesTrend(
  rows: DashboardTrendSaleRow[],
  period: PulseDashboardPeriodValue,
  now: Date = new Date(),
): PulseDashboardSalesTrendDto {
  if (period === 'year') {
    return buildYearTrend(rows, now);
  }

  if (period === 'today') {
    return buildTodayBucketTrend(rows, now);
  }

  return buildDayTrend(rows);
}

export function buildDashboardTrendQueryRange(
  currentRange: TimeRange,
): { gte: Date; lte: Date } {
  return {
    gte: new Date(currentRange.start),
    lte: new Date(currentRange.end),
  };
}

function buildYearTrend(
  rows: DashboardTrendSaleRow[],
  now: Date,
): PulseDashboardSalesTrendDto {
  const byMonth = Array.from({ length: 12 }, () => 0);
  for (const row of rows) {
    const month = row.date.getMonth();
    byMonth[month] = new Decimal(byMonth[month])
      .plus(row.totalRevenue)
      .toDecimalPlaces(2)
      .toNumber();
  }

  const currentMonth = now.getMonth();
  const actual = byMonth.map((value, index) =>
    index <= currentMonth ? value : null,
  );

  return {
    categories: DASHBOARD_TREND_YEAR_MONTH_LABELS,
    actual,
    isYearMode: true,
  };
}

function buildDayTrend(rows: DashboardTrendSaleRow[]): PulseDashboardSalesTrendDto {
  const dayMap = new Map<string, number>();
  for (const row of rows) {
    const label = formatDateLabel(row.date);
    dayMap.set(
      label,
      new Decimal(dayMap.get(label) ?? 0)
        .plus(row.totalRevenue)
        .toDecimalPlaces(2)
        .toNumber(),
    );
  }

  return {
    categories: Array.from(dayMap.keys()),
    actual: Array.from(dayMap.values()),
    isYearMode: false,
  };
}

function buildTodayBucketTrend(
  rows: DashboardTrendSaleRow[],
  now: Date,
): PulseDashboardSalesTrendDto {
  const buckets = Array.from(
    { length: DASHBOARD_TREND_TODAY_BUCKET_HOURS.length },
    () => 0,
  );
  for (const row of rows) {
    const hour = row.date.getHours();
    const bucketIndex = DASHBOARD_TREND_TODAY_BUCKET_HOURS.findIndex(
      (bucketHour, index) => {
        const nextBucketHour = DASHBOARD_TREND_TODAY_BUCKET_HOURS[index + 1];

        return (
          hour >= bucketHour &&
          (nextBucketHour === undefined || hour < nextBucketHour)
        );
      },
    );
    if (bucketIndex >= 0) {
      buckets[bucketIndex] = new Decimal(buckets[bucketIndex])
        .plus(row.totalRevenue)
        .toDecimalPlaces(2)
        .toNumber();
    }
  }

  const currentHour = now.getHours();
  const actual = buckets.map((value, index) => {
    const bucketHour = DASHBOARD_TREND_TODAY_BUCKET_HOURS[index];
    return currentHour >= bucketHour ? value : null;
  });

  return {
    categories: DASHBOARD_TREND_TODAY_BUCKET_LABELS,
    actual,
    isYearMode: false,
  };
}
