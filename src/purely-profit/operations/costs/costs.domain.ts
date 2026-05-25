import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import {
  buildPreviousPurchaseDateRange,
  buildPurchaseDateRange,
} from '../../commerce/commerce.utils';
import type {
  CostAmountRow,
  CostFilterRange,
  CostQueryInput,
  CostReportQueryInput,
  CostReportRange,
} from './costs.types';
import type {
  CostReportResponseDto,
  CostStatsResponseDto,
} from './dto/costs-response.dto';

export function buildEmptyCostStatsResponse(): CostStatsResponseDto {
  return {
    total: 0,
    fixed: 0,
    variable: 0,
    compareLastPeriod: null,
    recordCount: 0,
  };
}

export function buildEmptyCostReportResponse(): CostReportResponseDto {
  return {
    summary: buildEmptyCostStatsResponse(),
    categories: [],
    detailRows: [],
  };
}

export function sumCostAmounts(records: CostAmountRow[]): number {
  return Number(
    records
      .reduce(
        (total, record) => total.plus(record.amount.toString()),
        new Decimal(0),
      )
      .toFixed(2),
  );
}

export function calculateCostCompareLastPeriod(
  currentTotal: number,
  previousTotal: number,
): number | null {
  if (previousTotal <= 0) {
    return null;
  }

  return Number(
    new Decimal(currentTotal)
      .minus(previousTotal)
      .div(previousTotal)
      .mul(100)
      .toFixed(2),
  );
}

export function buildCostRange(
  query: CostQueryInput,
): CostFilterRange | undefined {
  return buildPurchaseDateRange(
    query.period,
    query.customDate,
    query.rangeStartDate,
    query.rangeEndDate,
  );
}

export function buildPreviousCostRange(
  query: CostQueryInput,
): CostFilterRange | undefined {
  return buildPreviousPurchaseDateRange(buildCostRange(query));
}

export function shouldComparePreviousCostPeriod(
  period: CostQueryInput['period'],
): boolean {
  return (
    period === 'week' ||
    period === 'month' ||
    period === 'quarter' ||
    period === 'all'
  );
}

export function buildCostReportRange(
  query: CostReportQueryInput,
): CostReportRange {
  const period = query.period ?? 'month';
  const now = Date.now();
  const current = new Date(now);

  switch (period) {
    case 'today':
      return {
        start: getDayStart(now),
        end: now,
        period,
      };
    case 'week': {
      const start = new Date(current);
      const day = start.getDay();
      const diff = day === 0 ? -6 : 1 - day;
      start.setDate(start.getDate() + diff);
      start.setHours(0, 0, 0, 0);
      return {
        start: start.getTime(),
        end: now,
        period,
      };
    }
    case 'month':
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
        end: now,
        period,
      };
    case 'quarter': {
      const quarterStartMonth = Math.floor(current.getMonth() / 3) * 3;
      return {
        start: new Date(
          current.getFullYear(),
          quarterStartMonth,
          1,
          0,
          0,
          0,
          0,
        ).getTime(),
        end: now,
        period,
      };
    }
    case 'year': {
      const year = query.year ?? current.getFullYear();
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
          '自定义区间模式需要同时传 rangeStartDate 和 rangeEndDate',
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

export function buildPreviousCostReportRange(
  period: CostReportQueryInput['period'],
  currentRange: CostReportRange,
): CostReportRange | null {
  const resolvedPeriod = period ?? 'month';

  switch (resolvedPeriod) {
    case 'today':
    case 'custom_month':
      return {
        start: getDayStart(currentRange.start - 24 * 60 * 60 * 1000),
        end: currentRange.start - 1,
        period: resolvedPeriod,
      };
    case 'week':
      return {
        start: currentRange.start - 7 * 24 * 60 * 60 * 1000,
        end: currentRange.start - 1,
        period: resolvedPeriod,
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
        period: resolvedPeriod,
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
        period: resolvedPeriod,
      };
    }
    case 'year': {
      const currentStart = new Date(currentRange.start);
      const year = currentStart.getFullYear() - 1;
      return {
        start: new Date(year, 0, 1, 0, 0, 0, 0).getTime(),
        end: new Date(year, 11, 31, 23, 59, 59, 999).getTime(),
        period: resolvedPeriod,
      };
    }
    case 'custom_range': {
      const duration = currentRange.end - currentRange.start;
      return {
        start: currentRange.start - duration - 1,
        end: currentRange.start - 1,
        period: resolvedPeriod,
      };
    }
  }
}

export function toPayrollMonth(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function getPayrollCostDate(month: string): Date {
  const [yearText, monthText] = month.split('-');
  const year = Number(yearText);
  const monthValue = Number(monthText);
  return new Date(year, monthValue - 1, 1, 0, 0, 0, 0);
}

export function toCostDecimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(new Decimal(value).toFixed(2));
}

function getDayStart(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function getDayEnd(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(23, 59, 59, 999);
  return date.getTime();
}
