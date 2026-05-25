import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import { DAY_MS } from './finance.constants';
import {
  FINANCE_DEFAULT_PAGE,
  FINANCE_DEFAULT_PAGE_SIZE,
  type FinanceCashFlowFilterRange,
  type FinanceCashFlowListQueryInput,
  type FinanceOverviewPeriodValue,
  type FinanceReportQueryInput,
  type FinanceReportRange,
  type PaginationState,
} from './finance.types';

export type PrismaDecimalLike = Prisma.Decimal | Decimal | number | string;

export function buildPaginationState(
  page?: number,
  pageSize?: number,
): PaginationState {
  return {
    page: page ?? FINANCE_DEFAULT_PAGE,
    pageSize: pageSize ?? FINANCE_DEFAULT_PAGE_SIZE,
    total: 0,
    totalPages: 0,
  };
}

export function buildPaginationMeta(
  page: number,
  pageSize: number,
  total: number,
): PaginationState {
  return {
    page,
    pageSize,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
  };
}

export function paginateArray<T>(items: T[], meta: PaginationState): T[] {
  const start = (meta.page - 1) * meta.pageSize;
  return items.slice(start, start + meta.pageSize);
}

export function toPrismaDecimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value.toFixed(2));
}

export function roundMoneyValue(value: PrismaDecimalLike): number {
  return new Decimal(value.toString())
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
    .toNumber();
}

export function toMoneyNumber(value: PrismaDecimalLike): number {
  return roundMoneyValue(new Decimal(value.toString()));
}

export function addMoneyValues(left: number, right: number): number {
  return roundMoneyValue(new Decimal(left).plus(right));
}

export function subtractMoneyValues(left: number, right: number): number {
  return roundMoneyValue(new Decimal(left).minus(right));
}

export function calcPercent(amount: number, total: number): number {
  if (isZeroValue(total)) {
    return 0;
  }

  return new Decimal(amount)
    .div(total)
    .mul(100)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    .toNumber();
}

export function isZeroValue(value: number): boolean {
  return new Decimal(value).isZero();
}

export function trimOptionalString(value?: string | null): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

export function getDayStart(timestamp: number): number {
  const current = new Date(timestamp);
  current.setHours(0, 0, 0, 0);
  return current.getTime();
}

export function getDayEnd(timestamp: number): number {
  const current = new Date(timestamp);
  current.setHours(23, 59, 59, 999);
  return current.getTime();
}

export function formatReportDateLabel(timestamp: number): string {
  const current = new Date(timestamp);
  return `${current.getFullYear()}-${current.getMonth() + 1}-${current.getDate()}`;
}

export function formatMonthDay(timestamp: number): string {
  const current = new Date(timestamp);
  const month = String(current.getMonth() + 1).padStart(2, '0');
  const day = String(current.getDate()).padStart(2, '0');
  return `${month}/${day}`;
}

export function getWeekStart(current: Date): number {
  const day = current.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(current);
  monday.setDate(current.getDate() + diff);
  monday.setHours(0, 0, 0, 0);
  return monday.getTime();
}

export function getOverviewCurrentRange(
  period: FinanceOverviewPeriodValue,
): { start: number; end: number } {
  const now = Date.now();
  const todayStart = getDayStart(now);
  const end = todayStart + DAY_MS - 1;

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

  return { start: 0, end };
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
