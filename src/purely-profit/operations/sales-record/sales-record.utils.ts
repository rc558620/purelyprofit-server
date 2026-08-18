import { BadRequestException } from '@nestjs/common';
import {
  getDayEndTimestamp,
  getEndOfDay,
  getStartOfDay,
} from '../../commerce/commerce.utils';
import { Money } from '../../../shared/money.utils';
import {
  addShanghaiDays,
  formatShanghaiDate,
  getShanghaiMonth,
  getShanghaiMonthStartMs,
  getShanghaiQuarterStartMs,
  getShanghaiWeekStartMs,
  getShanghaiYear,
  makeShanghaiMs,
} from '../../../shared/shanghai-time.utils';
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
  now = Date.now(),
): SalesPeriodRange {
  const period = query.period ?? 'today';

  switch (period) {
    case 'today':
      return {
        start: getStartOfDay(now).getTime(),
        end: now,
      };
    case 'week': {
      return {
        start: getShanghaiWeekStartMs(now),
        end: now,
      };
    }
    case 'month': {
      return {
        start: getShanghaiMonthStartMs(now),
        end: now,
      };
    }
    case 'quarter': {
      return {
        start: getShanghaiQuarterStartMs(now),
        end: now,
      };
    }
    case 'year': {
      const year = query.year ?? getShanghaiYear(now);
      return {
        start: makeShanghaiMs(year, 0, 1),
        // 该年上海时区 12/31 23:59:59.999 = 次年元旦零点 -1ms
        end: makeShanghaiMs(year + 1, 0, 1) - 1,
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

  if (period === 'today') {
    // 今日对比昨日整天
    const yesterdayStart = addShanghaiDays(currentRange.start, -1);
    return {
      start: yesterdayStart,
      end: getDayEndTimestamp(yesterdayStart),
    };
  }

  if (period === 'week') {
    // 本周对比上周整周
    const prevWeekStart = addShanghaiDays(currentRange.start, -7);
    return {
      start: prevWeekStart,
      end: getDayEndTimestamp(addShanghaiDays(prevWeekStart, 6)),
    };
  }

  if (period === 'month') {
    const year = getShanghaiYear(currentRange.start);
    const month = getShanghaiMonth(currentRange.start);
    return {
      start: makeShanghaiMs(year, month - 1, 1),
      // 上月最后一整天的末尾 = 本月 1 号零点 -1ms
      end: makeShanghaiMs(year, month, 1) - 1,
    };
  }

  if (period === 'quarter') {
    const year = getShanghaiYear(currentRange.start);
    const quarterStartMonth = getShanghaiMonth(currentRange.start);
    return {
      start: makeShanghaiMs(year, quarterStartMonth - 3, 1),
      // 上季度末尾 = 本季度首日零点 -1ms
      end: makeShanghaiMs(year, quarterStartMonth, 1) - 1,
    };
  }

  // 兜底：等长时长前推
  const duration = currentRange.end - currentRange.start;
  return {
    start: currentRange.start - duration - 1,
    end: currentRange.start - 1,
  };
}

// ---------------------------------------------------------------------------
// 订单号生成
// ---------------------------------------------------------------------------

/**
 * 订单号号段：standard 普通销售单（#YYYYMMDD-NNN）/ manual 手工补录单（#M-YYYYMMDD-NNN）。
 * 两类号段各自独立计数，互不挤占序号。
 */
export type SalesOrderNoVariant = 'standard' | 'manual';

export function buildOrderNo(
  date: Date,
  seq: number,
  variant: SalesOrderNoVariant = 'standard',
): string {
  // 订单号日期段必须与营业日（上海时区）一致
  const dateSegment = formatShanghaiDate(date.getTime()).replace(/-/g, '');
  const serial = String(seq).padStart(3, '0');
  return variant === 'manual'
    ? `#M-${dateSegment}-${serial}`
    : `#${dateSegment}-${serial}`;
}

// ---------------------------------------------------------------------------
// 金额工具
// ---------------------------------------------------------------------------

/**
 * 校验前端入站的正数金额，返回 Money 对象。
 * 适用于 salePrice、profit 等必须 >= 0 的金额。
 */
export function normalizeMoney(value: number, errorMessage: string): Money {
  if (!Number.isFinite(value) || value < 0) {
    throw new BadRequestException(errorMessage);
  }
  return Money.fromInputYuan(value);
}

/**
 * 校验前端入站的可为负数的金额，返回 Money 对象。
 * 适用于抵扣项的 salePrice、profit 等允许负数的金额。
 */
export function normalizeSignedMoney(
  value: number,
  errorMessage: string,
): Money {
  if (!Number.isFinite(value)) {
    throw new BadRequestException(errorMessage);
  }
  return Money.fromInputYuan(value);
}

/**
 * 汇总金额列表，返回元精度的输出值。
 * getter 返回的是元精度金额（前端入站或中间计算结果）。
 */
export function sumMoneyToYuan<T>(
  items: T[],
  getter: (item: T) => Money,
): number {
  return Money.sum(items.map(getter)).toOutputYuan();
}

/**
 * 汇总金额列表，返回分精度的数据库值。
 * getter 返回的是元精度金额（前端入站或中间计算结果）。
 */
export function sumMoneyToDbCents<T>(
  items: T[],
  getter: (item: T) => Money,
): number {
  return Money.sum(items.map(getter)).toDbCents();
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
