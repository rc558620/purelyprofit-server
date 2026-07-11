import { DAY_MS } from './dashboard-home.constants';
import type {
  DashboardHomePeriodValue,
  TimeRange,
} from './dashboard-home.types';
import {
  getShanghaiDayStartMs,
  getShanghaiFullYear,
  getShanghaiMonthIndex,
  getShanghaiMonthStartMsForYearMonth,
  getShanghaiMonthStartMs,
  getShanghaiWeekStartMs,
  getShanghaiYearEndMsForYear,
  getShanghaiYearStartMsForYear,
} from '../../../shared/shanghai-time.utils';

export function buildCurrentRange(period: DashboardHomePeriodValue): TimeRange {
  const now = Date.now();
  const shanghaiYear = getShanghaiFullYear(now);

  switch (period) {
    case 'today':
      return {
        start: getShanghaiDayStartMs(now),
        end: now,
      };
    case 'week':
      return {
        start: getShanghaiWeekStartMs(now),
        end: now,
      };
    case 'month':
      return {
        start: getShanghaiMonthStartMs(now),
        end: now,
      };
    case 'year':
      return {
        start: getShanghaiYearStartMsForYear(shanghaiYear),
        end: now,
      };
    case 'last_year': {
      const year = shanghaiYear - 1;
      return {
        start: getShanghaiYearStartMsForYear(year),
        end: getShanghaiYearEndMsForYear(year),
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
      const currentYear = getShanghaiFullYear(currentRange.start);
      const currentMonth = getShanghaiMonthIndex(currentRange.start);
      let previousMonthYear = currentYear;
      let previousMonthIndex = currentMonth - 1;
      if (previousMonthIndex < 0) {
        previousMonthIndex = 11;
        previousMonthYear -= 1;
      }
      const previousMonthStart = getShanghaiMonthStartMsForYearMonth(
        previousMonthYear,
        previousMonthIndex,
      );
      const nextMonthIndex = previousMonthIndex + 1;
      const nextMonthYear = previousMonthYear + (nextMonthIndex > 11 ? 1 : 0);
      const previousMonthEnd =
        getShanghaiMonthStartMsForYearMonth(
          nextMonthYear,
          nextMonthIndex > 11 ? 0 : nextMonthIndex,
        ) - 1;
      return {
        start: previousMonthStart,
        end: Math.min(previousMonthStart + currentDuration, previousMonthEnd),
      };
    }
    case 'year': {
      const currentYear = getShanghaiFullYear(currentRange.start);
      const previousYearStart = getShanghaiYearStartMsForYear(currentYear - 1);
      const previousYearEnd = getShanghaiYearEndMsForYear(currentYear - 1);
      return {
        start: previousYearStart,
        end: Math.min(previousYearStart + currentDuration, previousYearEnd),
      };
    }
    case 'last_year': {
      const currentYear = getShanghaiFullYear(currentRange.start);
      const compareYear = currentYear - 1;
      return {
        start: getShanghaiYearStartMsForYear(compareYear),
        end: getShanghaiYearEndMsForYear(compareYear),
      };
    }
  }
}
