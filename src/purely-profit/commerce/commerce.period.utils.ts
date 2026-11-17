/**
 * 统计期次（周 / 月 / 季度 / 年 / 自定义）的时间范围换算。
 *
 * 全链路统一使用上海时区的自然周期边界（见 shared/shanghai-time.utils），
 * 禁止在业务侧用 `new Date().setHours(0,0,0,0)` 之类的本地时区写法，
 * 否则跨时区部署与夏令时场景会让日报 / 周报边界漂移一天。
 */
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

/** 时间区间（闭区间，毫秒精度）。 */
interface DateRange {
  gte: Date;
  lte: Date;
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

/**
 * 自然月 / 季度对齐的上期区间：起点回到目标周期首日，
 * 终点按偏移月数钳制（月末按目标月最后一天，属已知接受项）。
 */
function buildPreviousMonthAlignedRange(
  start: number,
  end: number,
  monthsBack: number,
): DateRange {
  return {
    gte: new Date(
      makeShanghaiMs(
        getShanghaiYear(start),
        getShanghaiMonth(start) - monthsBack,
        1,
      ),
    ),
    lte: new Date(addShanghaiMonths(end, -monthsBack)),
  };
}

/** 自然年对齐的上期区间：闰年 2/29 偏移后钳制到 2/28，属已知接受项。 */
function buildPreviousYearAlignedRange(start: number, end: number): DateRange {
  return {
    gte: new Date(makeShanghaiMs(getShanghaiYear(start) - 1, 0, 1)),
    lte: new Date(addShanghaiYears(end, -1)),
  };
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
      return buildPreviousMonthAlignedRange(start, end, 1);
    case 'quarter':
      return buildPreviousMonthAlignedRange(start, end, 3);
    case 'year':
      return buildPreviousYearAlignedRange(start, end);
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
