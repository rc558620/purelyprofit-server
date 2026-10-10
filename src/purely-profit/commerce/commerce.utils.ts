import type { InventoryAdjustType } from '@prisma/client';
import { PaginationMetaDto } from '../stores/dto/store-response.dto';
import {
  addShanghaiMonths,
  addShanghaiYears,
  formatShanghaiDayLabel,
  getShanghaiDayStartMs,
  getShanghaiMonth,
  getShanghaiMonthStartMs,
  getShanghaiQuarterStartMs,
  getShanghaiWeekStartMs,
  getShanghaiYear,
  getShanghaiYearStartMs,
  makeShanghaiMs,
} from '../../shared/shanghai-time.utils';

const DAY_MS = 86_400_000;

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
 * 自助下单已在线支付商品的抵扣行。
 * 顾客在小程序侧已通过余额/微信完成支付，结算时以同名负向行把该部分
 * 从空间账单应付中冲减（与续费/预付款抵扣同一记账模式），避免重复收费。
 * productName 同样需要被非财务模块排除，只算实际消费。
 */
export const SELF_ORDER_DEDUCTION_PRODUCT_ID = 'SYS_SELF_ORDER_DEDUCTION';
export const SELF_ORDER_DEDUCTION_PRODUCT_NAME = '自助下单抵扣';

/**
 * 台位费展示名正则：兼容「台位费（固定）/ 台位费（按单价）」
 * 与「台位费 2小时30分钟」（计时模式已去掉括号）两种形式。
 * 列表 / 报表 / CSV / 件数统计共用，避免各处复制正则导致判定漂移。
 */
export const TABLE_FEE_NAME_RE = /^台位费(（|\s|$)/;

/**
 * 是否为「不计入销售件数」的系统虚拟行。
 *
 * 与空间结账的 isNonQuantitySystemItem(productId) 同一口径，但落库后
 * 系统行的 product_id 一律为 null（SYS_ 前缀 ID 非数字，写入 Int 列被置空），
 * 因此读取侧只能按 productName 反向识别：
 * - 抵扣行（预付/续费/自助下单）：负数金额行，不表示真实销售件数；
 * - 台位费行（计时/一口价）：按时间计费，不是商品销量。
 *
 * ⚠️ 金额（营业额/利润）不在此排除——抵扣行必须与它对应的商品行配对后才能
 * 互相冲抵。单独剔除任一侧都会导致金额重复计算（详见 listVisibleSaleOrderItems）。
 */
export function isNonQuantitySalesRecordRow(productName: string): boolean {
  return (
    isDeductionProductName(productName) ||
    productName.endsWith(` · ${SELF_ORDER_DEDUCTION_PRODUCT_NAME}`) ||
    TABLE_FEE_NAME_RE.test(productName)
  );
}

/**
 * 判断商品行是否为抵扣行（预付款/续费抵扣/自助下单抵扣），
 * 非财务模块应排除这些行，只算实际消费。
 * 兼容历史数据中 productName = '预付抵扣' 的旧值。
 */
export function isDeductionProductName(productName: string): boolean {
  return (
    productName === PREPAID_DEDUCTION_PRODUCT_NAME ||
    productName === '预付抵扣' || // 兼容历史数据
    productName === RENEW_DEDUCTION_PRODUCT_NAME ||
    productName === SELF_ORDER_DEDUCTION_PRODUCT_NAME
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
      item.systemProductId === 'SYS_PREPAID_DEDUCTION' ||
      item.systemProductId === SELF_ORDER_DEDUCTION_PRODUCT_ID
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
  return new Date(getShanghaiDayStartMs(timestampMs));
}

export function getEndOfDay(timestampMs: number): Date {
  return new Date(getShanghaiDayStartMs(timestampMs) + DAY_MS - 1);
}

export function getDayStartTimestamp(timestampMs: number): number {
  return getShanghaiDayStartMs(timestampMs);
}

export function getDayEndTimestamp(timestampMs: number): number {
  return getShanghaiDayStartMs(timestampMs) + DAY_MS - 1;
}

export function getWeekStartTimestamp(timestampMs: number): number {
  return getShanghaiWeekStartMs(timestampMs);
}

export function getMonthStartTimestamp(timestampMs: number): number {
  return getShanghaiMonthStartMs(timestampMs);
}

export function getQuarterStartTimestamp(timestampMs: number): number {
  return getShanghaiQuarterStartMs(timestampMs);
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
  return formatShanghaiDayLabel(timestampMs);
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
      return {
        gte: new Date(getShanghaiWeekStartMs(now.getTime())),
        lte: new Date(now),
      };
    }
    case 'month':
      return {
        gte: new Date(getShanghaiMonthStartMs(now.getTime())),
        lte: new Date(now),
      };
    case 'quarter': {
      return {
        gte: new Date(getShanghaiQuarterStartMs(now.getTime())),
        lte: new Date(now),
      };
    }
    case 'year':
      return {
        gte: new Date(getShanghaiYearStartMs(now.getTime())),
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
  period?: PurchasePeriodValue,
): { gte: Date; lte: Date } | undefined {
  if (!currentRange) return undefined;
  const start = currentRange.gte.getTime();
  const end = currentRange.lte.getTime();
  const duration = end - start;
  if (duration < 0) return undefined;

  switch (period) {
    case 'week':
      return {
        gte: new Date(start - 7 * DAY_MS),
        lte: new Date(end - 7 * DAY_MS),
      };
    case 'month':
      return {
        gte: new Date(
          makeShanghaiMs(
            getShanghaiYear(start),
            getShanghaiMonth(start) - 1,
            1,
          ),
        ),
        // 月末按目标月最后一天钳制，属已知接受项
        lte: new Date(addShanghaiMonths(end, -1)),
      };
    case 'quarter':
      return {
        gte: new Date(
          makeShanghaiMs(
            getShanghaiYear(start),
            getShanghaiMonth(start) - 3,
            1,
          ),
        ),
        lte: new Date(addShanghaiMonths(end, -3)),
      };
    case 'year':
      // 闰年 2/29 偏移后钳制到 2/28，属已知接受项
      return {
        gte: new Date(makeShanghaiMs(getShanghaiYear(start) - 1, 0, 1)),
        lte: new Date(addShanghaiYears(end, -1)),
      };
    case 'custom_month':
      return {
        gte: new Date(getShanghaiDayStartMs(start - DAY_MS)),
        lte: new Date(start - 1),
      };
    case 'custom_range': {
      const effective = Math.max(Math.min(end, Date.now()) - start, 0);
      return {
        gte: new Date(start - effective - 1),
        lte: new Date(start - 1),
      };
    }
    default:
      // all / undefined：无周期概念，保持紧邻等长段
      return {
        gte: new Date(start - duration - 1),
        lte: new Date(start - 1),
      };
  }
}
