import { BadRequestException } from '@nestjs/common';
import { DAY_MS } from './finance.constants';
import {
  getShanghaiDayStartMs,
  getShanghaiWeekStartMs,
} from './finance-date.utils';
import type {
  FinanceCashFlowFilterRange,
  FinanceCashFlowListQueryInput,
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

function assertCustomDateComplete(
  label: string,
  year?: number,
  month?: number,
  day?: number,
): void {
  if (year == null || month == null || day == null) {
    throw new BadRequestException(`自定义${label}必须同时提供年、月、日`);
  }
}

export function getCashFlowFilterRange(
  query: FinanceCashFlowListQueryInput,
): FinanceCashFlowFilterRange {
  const period = query.period ?? 'month';
  const now = Date.now();

  if (period === 'custom_range') {
    assertCustomDateComplete(
      '区间开始',
      query.customRangeStartYear,
      query.customRangeStartMonth,
      query.customRangeStartDay,
    );
    assertCustomDateComplete(
      '区间结束',
      query.customRangeEndYear,
      query.customRangeEndMonth,
      query.customRangeEndDay,
    );
    const start = shanghaiDateToUtcMs(
      query.customRangeStartYear!,
      query.customRangeStartMonth! - 1,
      query.customRangeStartDay!,
    );
    const end =
      shanghaiDateToUtcMs(
        query.customRangeEndYear!,
        query.customRangeEndMonth! - 1,
        query.customRangeEndDay! + 1,
      ) - 1;
    return {
      start,
      end: Math.max(start, end),
      period,
    };
  }

  if (period === 'custom_day') {
    assertCustomDateComplete(
      '单日',
      query.customDayYear,
      query.customDayMonth,
      query.customDayDay,
    );
    const start = shanghaiDateToUtcMs(
      query.customDayYear!,
      query.customDayMonth! - 1,
      query.customDayDay!,
    );
    return {
      start,
      end: start + DAY_MS - 1,
      period,
    };
  }

  const todayStart = getShanghaiDayStartMs(now);

  if (period === 'today') {
    return { start: todayStart, end: now, period };
  }

  if (period === 'week') {
    return { start: getShanghaiWeekStartMs(now), end: now, period };
  }

  const { year, month } = shanghaiDateParts(todayStart);

  if (period === 'month') {
    return {
      start: shanghaiDateToUtcMs(year, month, 1),
      end: now,
      period,
    };
  }

  if (period === 'quarter') {
    const quarterMonth = Math.floor(month / 3) * 3;
    return {
      start: shanghaiDateToUtcMs(year, quarterMonth, 1),
      end: now,
      period,
    };
  }

  // year / fallback
  return {
    start: shanghaiDateToUtcMs(year, 0, 1),
    end: now,
    period,
  };
}

export function getPreviousCashFlowRange(
  period: FinanceCashFlowFilterRange['period'],
): { start: number; end: number } | null {
  const now = Date.now();

  if (period === 'custom_day' || period === 'custom_range') {
    return null;
  }

  if (period === 'today') {
    const todayStart = getShanghaiDayStartMs(now);
    return {
      start: todayStart - DAY_MS,
      end: todayStart - 1,
    };
  }

  if (period === 'week') {
    const weekStart = getShanghaiWeekStartMs(now);
    return {
      start: weekStart - 7 * DAY_MS,
      end: weekStart - 1,
    };
  }

  const todayStart = getShanghaiDayStartMs(now);
  const { year, month } = shanghaiDateParts(todayStart);

  if (period === 'month') {
    const currentMonthStart = shanghaiDateToUtcMs(year, month, 1);
    const prevMonthStart = shanghaiDateToUtcMs(year, month - 1, 1);
    return {
      start: prevMonthStart,
      end: currentMonthStart - 1,
    };
  }

  if (period === 'quarter') {
    const quarterMonth = Math.floor(month / 3) * 3;
    const currentQuarterStart = shanghaiDateToUtcMs(year, quarterMonth, 1);
    const prevQuarterMonth = quarterMonth - 3;
    const prevQuarterYear = prevQuarterMonth < 0 ? year - 1 : year;
    const prevQuarterMonthNorm =
      prevQuarterMonth < 0 ? prevQuarterMonth + 12 : prevQuarterMonth;
    return {
      start: shanghaiDateToUtcMs(prevQuarterYear, prevQuarterMonthNorm, 1),
      end: currentQuarterStart - 1,
    };
  }

  // year
  const currentYearStart = shanghaiDateToUtcMs(year, 0, 1);
  return {
    start: shanghaiDateToUtcMs(year - 1, 0, 1),
    end: currentYearStart - 1,
  };
}
