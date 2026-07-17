import { BadRequestException } from '@nestjs/common';
import { DAY_MS } from './finance.constants';
import {
  getDayEnd,
  getDayStart,
  getShanghaiDayStartMs,
  getWeekStart,
} from './finance-date.utils';
import type {
  FinanceOverviewPeriodValue,
  FinanceReportQueryInput,
  FinanceReportRange,
} from './finance.types';

const SHANGHAI_OFFSET_MS = 8 * 60 * 60_000;

/** 从 UTC 毫秒时间戳提取上海本地日期分量（不依赖 Node.js 进程时区） */
function shanghaiDateParts(timestampMs: number): {
  year: number;
  month: number; // 0-based
  day: number;
  weekDay: number; // 0=Sun … 6=Sat
} {
  const d = new Date(timestampMs + SHANGHAI_OFFSET_MS);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth(),
    day: d.getUTCDate(),
    weekDay: d.getUTCDay(),
  };
}

/** 上海本地年月日零点 → UTC 毫秒时间戳 */
function shanghaiDateToUtcMs(year: number, month: number, day: number): number {
  return Date.UTC(year, month, day) - SHANGHAI_OFFSET_MS;
}

export function getOverviewCurrentRange(period: FinanceOverviewPeriodValue): {
  start: number;
  end: number;
} {
  const now = Date.now();
  const todayStart = getShanghaiDayStartMs(now);
  const end = todayStart + DAY_MS - 1;

  if (period === 'today') {
    return { start: todayStart, end };
  }

  if (period === 'week') {
    const { weekDay } = shanghaiDateParts(todayStart);
    const mondayOffset = weekDay === 0 ? 6 : weekDay - 1;
    return { start: todayStart - mondayOffset * DAY_MS, end };
  }

  const { year, month } = shanghaiDateParts(todayStart);

  if (period === 'month') {
    return {
      start: shanghaiDateToUtcMs(year, month, 1),
      end,
    };
  }

  if (period === 'quarter') {
    const quarterMonth = Math.floor(month / 3) * 3;
    return {
      start: shanghaiDateToUtcMs(year, quarterMonth, 1),
      end,
    };
  }

  // year / fallback
  return {
    start: shanghaiDateToUtcMs(year, 0, 1),
    end,
  };
}

/**
 * 概览「上一周期」范围，按日历周期与报表对齐（不再使用等长前置窗口）。
 * today → 昨天；week → 上周一零点起 7 天；month → 上月 1 号到本周期 start-1；
 * quarter → 上季度 1 号到本周期 start-1；year → 去年全年。
 */
export function getOverviewPreviousRange(
  period: FinanceOverviewPeriodValue,
  start: number,
  _end: number,
): { prevStart: number; prevEnd: number } {
  const { year, month } = shanghaiDateParts(start);

  if (period === 'today') {
    return {
      prevStart: start - DAY_MS,
      prevEnd: start - 1,
    };
  }

  if (period === 'week') {
    return {
      prevStart: start - 7 * DAY_MS,
      prevEnd: start - 1,
    };
  }

  if (period === 'month') {
    const prevMonthStart = shanghaiDateToUtcMs(
      month === 0 ? year - 1 : year,
      month === 0 ? 11 : month - 1,
      1,
    );
    return { prevStart: prevMonthStart, prevEnd: start - 1 };
  }

  if (period === 'quarter') {
    const quarterMonth = Math.floor(month / 3) * 3;
    const prevQuarterMonth = quarterMonth === 0 ? 9 : quarterMonth - 3;
    const prevQuarterYear = quarterMonth === 0 ? year - 1 : year;
    const prevQuarterStart = shanghaiDateToUtcMs(
      prevQuarterYear,
      prevQuarterMonth,
      1,
    );
    return { prevStart: prevQuarterStart, prevEnd: start - 1 };
  }

  // year
  const prevYearStart = shanghaiDateToUtcMs(year - 1, 0, 1);
  const prevYearEnd = shanghaiDateToUtcMs(year - 1, 11, 31) + DAY_MS - 1;
  return { prevStart: prevYearStart, prevEnd: prevYearEnd };
}

export function getFinanceReportRange(
  query: FinanceReportQueryInput,
): FinanceReportRange {
  const period = query.period ?? 'month';
  const now = new Date();
  const nowMs = now.getTime();

  switch (period) {
    case 'today':
      return { start: getDayStart(nowMs), end: nowMs, period };
    case 'week':
      return { start: getWeekStart(now), end: nowMs, period };
    case 'month':
      return {
        start: new Date(
          now.getFullYear(),
          now.getMonth(),
          1,
          0,
          0,
          0,
          0,
        ).getTime(),
        end: nowMs,
        period,
      };
    case 'quarter':
      return {
        start: new Date(
          now.getFullYear(),
          Math.floor(now.getMonth() / 3) * 3,
          1,
          0,
          0,
          0,
          0,
        ).getTime(),
        end: nowMs,
        period,
      };
    case 'year': {
      const year = query.year ?? now.getFullYear();
      return {
        start: new Date(year, 0, 1, 0, 0, 0, 0).getTime(),
        end: new Date(year, 11, 31, 23, 59, 59, 999).getTime(),
        period,
      };
    }
    case 'custom_month': {
      if (query.customDate === undefined) {
        throw new BadRequestException('自定义月份模式需要传 customDate');
      }
      const current = new Date(query.customDate);
      return {
        start: new Date(
          current.getFullYear(),
          current.getMonth(),
          1,
          0,
          0,
          0,
          0,
        ).getTime(),
        end: new Date(
          current.getFullYear(),
          current.getMonth() + 1,
          0,
          23,
          59,
          59,
          999,
        ).getTime(),
        period,
      };
    }
    case 'custom_range': {
      if (
        query.rangeStartDate === undefined ||
        query.rangeEndDate === undefined
      ) {
        throw new BadRequestException(
          '自定义区间模式需要传 rangeStartDate 和 rangeEndDate',
        );
      }
      const start = Math.min(query.rangeStartDate, query.rangeEndDate);
      const end = Math.max(query.rangeStartDate, query.rangeEndDate);
      return {
        start: getDayStart(start),
        end: getDayEnd(end),
        period,
      };
    }
  }
}

export function getPreviousFinanceReportRange(
  query: FinanceReportQueryInput,
  currentRange: FinanceReportRange,
): { start: number; end: number } | null {
  const period = query.period ?? 'month';

  switch (period) {
    case 'today':
      return {
        start: getDayStart(currentRange.start - DAY_MS),
        end: currentRange.start - 1,
      };
    case 'custom_month': {
      const currentStart = new Date(currentRange.start);
      return {
        start: new Date(
          currentStart.getFullYear(),
          currentStart.getMonth() - 1,
          1,
          0,
          0,
          0,
          0,
        ).getTime(),
        end: currentRange.start - 1,
      };
    }
    case 'week':
      return {
        start: currentRange.start - 7 * DAY_MS,
        end: currentRange.start - 1,
      };
    case 'month': {
      const currentStart = new Date(currentRange.start);
      return {
        start: new Date(
          currentStart.getFullYear(),
          currentStart.getMonth() - 1,
          1,
          0,
          0,
          0,
          0,
        ).getTime(),
        end: currentRange.start - 1,
      };
    }
    case 'quarter': {
      const currentStart = new Date(currentRange.start);
      return {
        start: new Date(
          currentStart.getFullYear(),
          currentStart.getMonth() - 3,
          1,
          0,
          0,
          0,
          0,
        ).getTime(),
        end: currentRange.start - 1,
      };
    }
    case 'year': {
      const year = (query.year ?? new Date().getFullYear()) - 1;
      return {
        start: new Date(year, 0, 1, 0, 0, 0, 0).getTime(),
        end: new Date(year, 11, 31, 23, 59, 59, 999).getTime(),
      };
    }
    case 'custom_range': {
      const duration = currentRange.end - currentRange.start;
      return {
        start: currentRange.start - duration - 1,
        end: currentRange.start - 1,
      };
    }
  }
}
