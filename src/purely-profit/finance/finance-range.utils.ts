import { BadRequestException } from '@nestjs/common';
import { DAY_MS } from './finance.constants';
import { getDayEnd, getDayStart, getWeekStart } from './finance-date.utils';
import type {
  FinanceCashFlowFilterRange,
  FinanceCashFlowListQueryInput,
  FinanceOverviewPeriodValue,
  FinanceReportQueryInput,
  FinanceReportRange,
} from './finance.types';

export function getOverviewCurrentRange(period: FinanceOverviewPeriodValue): {
  start: number;
  end: number;
} {
  const now = Date.now();
  const todayStart = getDayStart(now);
  const end = todayStart + DAY_MS - 1;

  if (period === 'today') {
    return { start: todayStart, end };
  }

  if (period === 'week') {
    const current = new Date(todayStart);
    const weekDay = current.getDay() === 0 ? 6 : current.getDay() - 1;
    return { start: todayStart - weekDay * DAY_MS, end };
  }

  if (period === 'month') {
    const current = new Date(todayStart);
    return {
      start: new Date(current.getFullYear(), current.getMonth(), 1).getTime(),
      end,
    };
  }

  if (period === 'quarter') {
    const current = new Date(todayStart);
    const quarter = Math.floor(current.getMonth() / 3);
    return {
      start: new Date(current.getFullYear(), quarter * 3, 1).getTime(),
      end,
    };
  }

  if (period === 'year') {
    const current = new Date(todayStart);
    return {
      start: new Date(current.getFullYear(), 0, 1).getTime(),
      end,
    };
  }

  const current = new Date(todayStart);
  return {
    start: new Date(current.getFullYear(), 0, 1).getTime(),
    end,
  };
}

export function getOverviewPreviousRange(
  start: number,
  end: number,
): { prevStart: number; prevEnd: number } {
  const duration = end - start;
  return {
    prevStart: start - duration - 1,
    prevEnd: start - 1,
  };
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
        throw new BadRequestException('自定义单日模式需要传 customDate');
      }
      return {
        start: getDayStart(query.customDate),
        end: getDayEnd(query.customDate),
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
    case 'custom_month':
      return {
        start: getDayStart(currentRange.start - DAY_MS),
        end: currentRange.start - 1,
      };
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

export function getCashFlowFilterRange(
  query: FinanceCashFlowListQueryInput,
): FinanceCashFlowFilterRange {
  const period = query.period ?? 'month';
  const now = new Date();
  const nowMs = now.getTime();

  if (period === 'custom_range') {
    const start = new Date(
      query.customRangeStartYear ?? now.getFullYear(),
      (query.customRangeStartMonth ?? now.getMonth() + 1) - 1,
      query.customRangeStartDay ?? 1,
      0,
      0,
      0,
      0,
    ).getTime();
    const end = new Date(
      query.customRangeEndYear ?? now.getFullYear(),
      (query.customRangeEndMonth ?? now.getMonth() + 1) - 1,
      query.customRangeEndDay ?? now.getDate(),
      23,
      59,
      59,
      999,
    ).getTime();
    return {
      start,
      end: Math.max(start, end),
      period,
    };
  }

  if (period === 'custom_day') {
    const year = query.customDayYear ?? now.getFullYear();
    const month = query.customDayMonth ?? now.getMonth() + 1;
    const day = query.customDayDay ?? now.getDate();
    return {
      start: new Date(year, month - 1, day, 0, 0, 0, 0).getTime(),
      end: new Date(year, month - 1, day, 23, 59, 59, 999).getTime(),
      period,
    };
  }

  if (period === 'today') {
    return { start: getDayStart(nowMs), end: nowMs, period };
  }

  if (period === 'week') {
    return { start: getWeekStart(now), end: nowMs, period };
  }

  if (period === 'month') {
    return {
      start: new Date(now.getFullYear(), now.getMonth(), 1).getTime(),
      end: nowMs,
      period,
    };
  }

  if (period === 'quarter') {
    return {
      start: new Date(
        now.getFullYear(),
        Math.floor(now.getMonth() / 3) * 3,
        1,
      ).getTime(),
      end: nowMs,
      period,
    };
  }

  return {
    start: new Date(now.getFullYear(), 0, 1).getTime(),
    end: nowMs,
    period,
  };
}

export function getPreviousCashFlowRange(
  period: FinanceCashFlowFilterRange['period'],
): { start: number; end: number } | null {
  const now = new Date();

  if (period === 'custom_day' || period === 'custom_range') {
    return null;
  }

  if (period === 'today') {
    const yesterday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - 1,
    );
    return {
      start: getDayStart(yesterday.getTime()),
      end: new Date(
        yesterday.getFullYear(),
        yesterday.getMonth(),
        yesterday.getDate(),
        23,
        59,
        59,
        999,
      ).getTime(),
    };
  }

  if (period === 'week') {
    const weekStart = getWeekStart(now);
    return {
      start: weekStart - 7 * DAY_MS,
      end: weekStart - 1,
    };
  }

  if (period === 'month') {
    return {
      start: new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime(),
      end: new Date(
        now.getFullYear(),
        now.getMonth(),
        0,
        23,
        59,
        59,
        999,
      ).getTime(),
    };
  }

  if (period === 'quarter') {
    const currentQuarterStart = new Date(
      now.getFullYear(),
      Math.floor(now.getMonth() / 3) * 3,
      1,
    ).getTime();
    return {
      start: new Date(
        now.getFullYear(),
        (Math.floor(now.getMonth() / 3) - 1) * 3,
        1,
      ).getTime(),
      end: currentQuarterStart - 1,
    };
  }

  const currentYearStart = new Date(now.getFullYear(), 0, 1).getTime();
  return {
    start: new Date(now.getFullYear() - 1, 0, 1).getTime(),
    end: currentYearStart - 1,
  };
}
