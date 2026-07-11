import type { InventoryAdjustType } from '@prisma/client';
import { PaginationMetaDto } from '../stores/dto/store-response.dto';

// 从 shared 重新导出统一金额值对象与工具函数，保持现有导入路径向后兼容
export {
  Money,
  calcPercentChange,
  calcPercentOfTotal,
  calcPercentPointDiff,
} from '../../shared/money.utils';

/**
 * 空间预付款商品的 productName。
 * 在数据库 sale_order_items 中，预付款行的 productId 为 null，
 * 只能通过 productName 识别。
 *
 * 在非财务模块（profit-detail、business-analysis、dashboard-home、sales-record、report-center）
 * 中应排除此 productName 的行，只算实际消费。
 * 财务模块（finance-overview）保留完整流水口径，不排除。
 */
export const PREPAID_DEDUCTION_PRODUCT_NAME = '预付款';

/**
 * 空间续费抵扣商品的 productName。
 * 在数据库 sale_order_items 中，续费抵扣行的 productId 为 null，
 * 只能通过 productName 识别。
 *
 * 与预付款同理，非财务模块应排除此行，只算实际消费。
 */
export const RENEW_DEDUCTION_PRODUCT_NAME = '续费抵扣';

/**
 * 判断商品行是否为抵扣行（预付款或续费抵扣），
 * 非财务模块应排除这些行，只算实际消费。
 * 兼容历史数据中 productName = '预付抵扣' 的旧值。
 */
export function isDeductionProductName(productName: string): boolean {
  return (
    productName === PREPAID_DEDUCTION_PRODUCT_NAME ||
    productName === '预付抵扣' || // 兼容历史数据
    productName === RENEW_DEDUCTION_PRODUCT_NAME
  );
}

/**
 * P2b fix: 基于 systemProductId 优先判定抵扣项，回退到 productName 兼容历史数据。
 * 供销售层替代 isDeductionProductName 使用，避免改名后判定静默失效。
 */
export function isDeductionItem(item: {
  systemProductId?: string;
  productName: string;
}): boolean {
  if (item.systemProductId) {
    return (
      item.systemProductId === 'SYS_RENEW_DEDUCTION' ||
      item.systemProductId === 'SYS_PREPAID_DEDUCTION'
    );
  }
  return isDeductionProductName(item.productName);
}

export interface ResolvedPagination {
  page: number;
  skip: number;
  take: number;
}

export type PurchasePeriodValue =
  | 'week'
  | 'month'
  | 'quarter'
  | 'year'
  | 'all'
  | 'custom_month'
  | 'custom_range';

export const PURCHASE_PERIOD_VALUES = [
  'week',
  'month',
  'quarter',
  'year',
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

export function toTimestampMs(value: Date): number {
  return value.getTime();
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

/**
 * 根据当期时间范围推算等长上期范围。
 *
 * 边界语义：当期 [start, end]，上期 [start - duration - 1, start - 1]。
 * SQL 中当期用 `>= start AND <= end`，上期用 `>= prevStart AND <= prevEnd`，
 * prevEnd = start - 1 保证与当期 start 无重叠、无间隙（毫秒精度）。
 */
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
    case 'year':
      return {
        gte: new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0),
        lte: new Date(now),
      };
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
      // B5-fix: 统一用 Math.min/max 纠正起止颠倒
      const rangeStart = getStartOfDay(Math.min(rangeStartMs, rangeEndMs));
      const rangeEnd = getEndOfDay(Math.max(rangeStartMs, rangeEndMs));
      return {
        gte: rangeStart,
        lte: rangeEnd,
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
