import { DAY_MS } from './dashboard-home.constants';
import type {
  DashboardHomePeriodValue,
  TimeRange,
} from './dashboard-home.types';
import {
  getDayStartTimestamp,
  getMonthStartTimestamp,
  getWeekStartTimestamp,
} from '../../commerce/commerce.utils';

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
