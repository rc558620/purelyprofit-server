import type { InventoryAdjustType } from '@prisma/client';
import Decimal from 'decimal.js';
import { PaginationMetaDto } from '../stores/dto/store-response.dto';

export type DecimalLike = {
  toString(): string;
};

export interface ResolvedPagination {
  page: number;
  skip: number;
  take: number;
}

export type PurchasePeriodValue =
  | 'week'
  | 'month'
  | 'quarter'
  | 'all'
  | 'custom_month'
  | 'custom_range';

export const PURCHASE_PERIOD_VALUES = [
  'week',
  'month',
  'quarter',
  'all',
  'custom_month',
  'custom_range',
] as const satisfies readonly PurchasePeriodValue[];

export const INVENTORY_ADJUST_TYPE_VALUES = [
  'restock',
  'damage',
  'manual',
  'sale',
] as const satisfies readonly InventoryAdjustType[];

export type InventoryStockAlertLevelValue = 'normal' | 'warning' | 'danger';

export const INVENTORY_STOCK_ALERT_LEVEL_VALUES = [
  'normal',
  'warning',
  'danger',
] as const satisfies readonly InventoryStockAlertLevelValue[];

export type InventoryStockSortValue =
  | 'name'
  | 'stock_asc'
  | 'stock_desc'
  | 'alert';

export const INVENTORY_STOCK_SORT_VALUES = [
  'name',
  'stock_asc',
  'stock_desc',
  'alert',
] as const satisfies readonly InventoryStockSortValue[];

export type InventoryAdjustModeValue = 'delta' | 'set';

export const INVENTORY_ADJUST_MODE_VALUES = [
  'delta',
  'set',
] as const satisfies readonly InventoryAdjustModeValue[];

export type ProductSortValue =
  | 'createdAt'
  | 'name'
  | 'price_asc'
  | 'price_desc'
  | 'profit_desc';

export const PRODUCT_SORT_VALUES = [
  'createdAt',
  'name',
  'price_asc',
  'price_desc',
  'profit_desc',
] as const satisfies readonly ProductSortValue[];

export function toDecimalNumber(value?: DecimalLike | number | null): number {
  if (value === undefined || value === null) {
    return 0;
  }

  if (typeof value === 'number') {
    return value;
  }

  return Number(value.toString());
}

export function toTimestampMs(value: Date): number {
  return value.getTime();
}

export function roundMoneyValue(value: number): number {
  return new Decimal(value)
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
    .toNumber();
}

export function addMoneyValues(left: number, right: number): number {
  return roundMoneyValue(new Decimal(left).plus(right).toNumber());
}

export function subtractMoneyValues(left: number, right: number): number {
  return roundMoneyValue(new Decimal(left).minus(right).toNumber());
}

export function multiplyMoneyValue(amount: number, multiplier: number): number {
  return roundMoneyValue(new Decimal(amount).mul(multiplier).toNumber());
}

export function calcPercentChange(
  current: number,
  previous: number,
): number | null {
  if (previous === 0) {
    return null;
  }

  return roundMoneyValue(
    new Decimal(current).minus(previous).div(previous).mul(100).toNumber(),
  );
}

export function calcPercentOfTotal(amount: number, total: number): number {
  if (total === 0) {
    return 0;
  }

  return roundMoneyValue(new Decimal(amount).div(total).mul(100).toNumber());
}

export function toOptionalTimestampMs(value?: Date | null): number | undefined {
  return value ? value.getTime() : undefined;
}

export function toOptionalText(value?: string | null): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const trimmedValue = value.trim();
  return trimmedValue === '' ? undefined : trimmedValue;
}

export function toOptionalMediaText(value?: string | null): string | undefined {
  const normalizedValue = toOptionalText(value);

  if (!normalizedValue || normalizedValue.startsWith('blob:')) {
    return undefined;
  }

  return normalizedValue;
}

export function toNullableText(value?: string): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  const trimmedValue = value.trim();
  return trimmedValue === '' ? null : trimmedValue;
}

export function toNullableMediaText(value?: string): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalizedValue = toOptionalMediaText(value);
  return normalizedValue ?? null;
}

export function buildPaginationMeta(
  total: number,
  page: number,
  pageSize: number,
): PaginationMetaDto {
  return {
    page,
    pageSize,
    total,
    totalPages: Math.max(Math.ceil(total / pageSize), 1),
  };
}

export function resolvePagination(
  page: number | undefined,
  pageSize: number | undefined,
  defaultPageSize: number,
  maxPageSize: number,
): ResolvedPagination {
  const safePage = page && page > 0 ? page : 1;
  const safePageSize = pageSize && pageSize > 0 ? pageSize : defaultPageSize;
  const take = Math.min(safePageSize, maxPageSize);

  return {
    page: safePage,
    skip: (safePage - 1) * take,
    take,
  };
}

export function getStartOfDay(timestampMs: number): Date {
  const date = new Date(timestampMs);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function getEndOfDay(timestampMs: number): Date {
  const date = new Date(timestampMs);
  date.setHours(23, 59, 59, 999);
  return date;
}

export function getDayStartTimestamp(timestampMs: number): number {
  return getStartOfDay(timestampMs).getTime();
}

export function getDayEndTimestamp(timestampMs: number): number {
  return getEndOfDay(timestampMs).getTime();
}

export function getWeekStartTimestamp(timestampMs: number): number {
  const date = new Date(timestampMs);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function getMonthStartTimestamp(timestampMs: number): number {
  const date = new Date(timestampMs);
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
}

export function getQuarterStartTimestamp(timestampMs: number): number {
  const date = new Date(timestampMs);
  const quarter = Math.floor(date.getMonth() / 3);
  return new Date(date.getFullYear(), quarter * 3, 1).getTime();
}

export function buildPreviousRangeByDuration(
  start: number,
  end: number,
): {
  start: number;
  end: number;
} {
  const duration = end - start;
  return {
    start: start - duration - 1,
    end: start - 1,
  };
}

export function formatMonthDayLabel(timestampMs: number): string {
  const date = new Date(timestampMs);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${month}/${day}`;
}

export function buildPurchaseDateRange(
  period: PurchasePeriodValue | undefined,
  customDateMs: number | undefined,
  rangeStartMs: number | undefined,
  rangeEndMs: number | undefined,
  now = new Date(),
): { gte: Date; lte: Date } | undefined {
  switch (period) {
    case 'week': {
      const current = new Date(now);
      const day = current.getDay();
      const diff = day === 0 ? -6 : 1 - day;
      current.setDate(current.getDate() + diff);
      current.setHours(0, 0, 0, 0);
      return {
        gte: current,
        lte: new Date(now),
      };
    }
    case 'month':
      return {
        gte: new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0),
        lte: new Date(now),
      };
    case 'quarter': {
      const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3;
      return {
        gte: new Date(now.getFullYear(), quarterStartMonth, 1, 0, 0, 0, 0),
        lte: new Date(now),
      };
    }
    case 'custom_month':
      return customDateMs === undefined
        ? undefined
        : {
            gte: getStartOfDay(customDateMs),
            lte: getEndOfDay(customDateMs),
          };
    case 'custom_range': {
      if (rangeStartMs === undefined || rangeEndMs === undefined) {
        return undefined;
      }
      const rangeStart = getStartOfDay(rangeStartMs);
      const rangeEnd = getEndOfDay(rangeEndMs);
      return {
        gte: rangeStart,
        lte: new Date(Math.max(rangeStart.getTime(), rangeEnd.getTime())),
      };
    }
    case 'all':
    default:
      return undefined;
  }
}

export function buildPreviousPurchaseDateRange(
  currentRange: { gte: Date; lte: Date } | undefined,
): { gte: Date; lte: Date } | undefined {
  if (!currentRange) {
    return undefined;
  }

  const duration = currentRange.lte.getTime() - currentRange.gte.getTime();
  if (duration < 0) {
    return undefined;
  }

  return {
    gte: new Date(currentRange.gte.getTime() - duration - 1),
    lte: new Date(currentRange.gte.getTime() - 1),
  };
}
