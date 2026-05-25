import { BadRequestException } from '@nestjs/common';
import { getEndOfDay, getStartOfDay } from '../../commerce/commerce.utils';
import type { SalesRecordPeriodValue } from './sales-record.types';

export interface SalesRecordQueryInput {
  storeId?: number;
  period?: SalesRecordPeriodValue;
  year?: number;
  customDate?: number;
  rangeStartDate?: number;
  rangeEndDate?: number;
}

export interface SalesPeriodRange {
  start: number;
  end: number;
}

// ---------------------------------------------------------------------------
// 时间范围计算
// ---------------------------------------------------------------------------

export function buildCurrentRange(
  query: SalesRecordQueryInput,
): SalesPeriodRange {
  const period = query.period ?? 'today';
  const now = Date.now();

  switch (period) {
    case 'today':
      return {
        start: getStartOfDay(now).getTime(),
        end: now,
      };
    case 'week': {
      const start = new Date();
      const day = start.getDay();
      const diff = day === 0 ? -6 : 1 - day;
      start.setDate(start.getDate() + diff);
      start.setHours(0, 0, 0, 0);
      return {
        start: start.getTime(),
        end: now,
      };
    }
    case 'month': {
      const current = new Date();
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
      };
    }
    case 'quarter': {
      const current = new Date();
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
      };
    }
    case 'year': {
      const year = query.year ?? new Date().getFullYear();
      return {
        start: new Date(year, 0, 1, 0, 0, 0, 0).getTime(),
        end: new Date(year, 11, 31, 23, 59, 59, 999).getTime(),
      };
    }
    case 'all':
      return {
        start: 0,
        end: now,
      };
    case 'custom_month': {
      if (query.customDate === undefined) {
        throw new BadRequestException('自定义单日模式需要传 customDate');
      }
      return {
        start: getStartOfDay(query.customDate).getTime(),
        end: getEndOfDay(query.customDate).getTime(),
      };
    }
    case 'custom_range': {
      if (
        query.rangeStartDate === undefined ||
        query.rangeEndDate === undefined
      ) {
        throw new BadRequestException(
          '自定义时间段模式需要同时传 rangeStartDate 和 rangeEndDate',
        );
      }
      const start = getStartOfDay(query.rangeStartDate).getTime();
      const end = getEndOfDay(query.rangeEndDate).getTime();
      return {
        start,
        end: Math.max(start, end),
      };
    }
    default:
      return {
        start: 0,
        end: now,
      };
  }
}

export function buildPreviousRange(
  query: SalesRecordQueryInput,
  currentRange: SalesPeriodRange,
): SalesPeriodRange | undefined {
  const period = query.period ?? 'today';

  if (
    period === 'all' ||
    period === 'year' ||
    period === 'custom_month' ||
    period === 'custom_range'
  ) {
    return undefined;
  }

  if (period === 'month') {
    const currentStart = new Date(currentRange.start);
    const previousStart = new Date(
      currentStart.getFullYear(),
      currentStart.getMonth() - 1,
      1,
      0,
      0,
      0,
      0,
    );
    return {
      start: previousStart.getTime(),
      end: currentRange.start - 1,
    };
  }

  const duration = currentRange.end - currentRange.start;
  return {
    start: currentRange.start - duration - 1,
    end: currentRange.start - 1,
  };
}

// ---------------------------------------------------------------------------
// 订单号生成
// ---------------------------------------------------------------------------

export function buildOrderNo(date: Date, seq: number): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const serial = String(seq).padStart(3, '0');
  return `#${year}${month}${day}-${serial}`;
}

// ---------------------------------------------------------------------------
// 金额工具
// ---------------------------------------------------------------------------

export function normalizeMoney(value: number, errorMessage: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new BadRequestException(errorMessage);
  }
  return Number(value.toFixed(2));
}

export function normalizeSignedMoney(
  value: number,
  errorMessage: string,
): number {
  if (!Number.isFinite(value)) {
    throw new BadRequestException(errorMessage);
  }
  return Number(value.toFixed(2));
}

export function isSameMoney(left: number, right: number): boolean {
  return Math.abs(left - right) < 0.01;
}

export function sumMoney<T>(items: T[], getter: (item: T) => number): number {
  return Number(items.reduce((sum, item) => sum + getter(item), 0).toFixed(2));
}

// ---------------------------------------------------------------------------
// 字符串解析
// ---------------------------------------------------------------------------

export function parseNumericProductId(raw?: string): number | null {
  if (!raw) {
    return null;
  }

  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }

  const parsed = Number.parseInt(trimmed, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}
