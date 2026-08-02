import {
  DASHBOARD_PERIOD_MONTH,
  DASHBOARD_PERIOD_TODAY,
  DASHBOARD_PERIOD_WEEK,
  DASHBOARD_PERIOD_YEAR,
  HOME_REVENUE_PERIOD_SEASON,
} from './dashboard.constants';
import type {
  PulseDashboardPeriodValue,
  PulseHomeRevenuePeriodValue,
} from './dto/pulse-dashboard-query.dto';
import {
  addShanghaiMonths,
  addShanghaiYears,
  formatShanghaiDayLabel,
  getShanghaiDayStartMs,
  getShanghaiMonthStartMs,
  getShanghaiQuarterStartMs,
  getShanghaiWeekStartMs,
  getShanghaiYearStartMs,
  parseShanghaiDateText,
} from '../../shared/shanghai-time.utils';

export const DAY_MS = 86_400_000;

export interface TimeRange {
  start: number;
  end: number;
}

export function buildCurrentRange(
  period: PulseDashboardPeriodValue,
  nowMs?: number,
): TimeRange {
  const now = nowMs ?? Date.now();
  const currentDayStart = getStartOfDay(now);

  // Dashboard overview / stores share the same period semantics.
  switch (period) {
    case DASHBOARD_PERIOD_TODAY:
      return { start: currentDayStart, end: now };
    case DASHBOARD_PERIOD_WEEK:
      return { start: getStartOfWeek(currentDayStart), end: now };
    case DASHBOARD_PERIOD_MONTH:
      return { start: getStartOfMonth(currentDayStart), end: now };
    case DASHBOARD_PERIOD_YEAR:
      return { start: getStartOfYear(currentDayStart), end: now };
  }
}

export function buildCompareRange(
  period: PulseDashboardPeriodValue,
  current: TimeRange,
): TimeRange {
  const currentDuration = current.end - current.start;

  // Compare against the previous equivalent period window.
  switch (period) {
    case DASHBOARD_PERIOD_TODAY:
      return { start: current.start - DAY_MS, end: current.end - DAY_MS };
    case DASHBOARD_PERIOD_WEEK:
      return {
        start: current.start - DAY_MS * 7,
        end: current.end - DAY_MS * 7,
      };
    case DASHBOARD_PERIOD_MONTH: {
      // 上海时区下前推一个月，月末溢出自动钳制（3/31 → 2/28）。
      const compareStart = addShanghaiMonths(current.start, -1);
      return {
        start: compareStart,
        end: compareStart + currentDuration,
      };
    }
    case DASHBOARD_PERIOD_YEAR: {
      const compareStart = addShanghaiYears(current.start, -1);
      return {
        start: compareStart,
        end: compareStart + currentDuration,
      };
    }
  }
}

export function buildHomeRevenueRange(
  period: PulseHomeRevenuePeriodValue,
  now: Date,
): TimeRange {
  const nowMs = now.getTime();
  let rangeStartMs: number;

  // Home / revenue-detail share the revenue period semantics.
  switch (period) {
    case DASHBOARD_PERIOD_TODAY:
      rangeStartMs = getShanghaiDayStartMs(nowMs);
      break;
    case DASHBOARD_PERIOD_WEEK:
      rangeStartMs = getShanghaiWeekStartMs(nowMs);
      break;
    case HOME_REVENUE_PERIOD_SEASON:
      rangeStartMs = getShanghaiQuarterStartMs(nowMs);
      break;
    case DASHBOARD_PERIOD_MONTH:
    default:
      rangeStartMs = getShanghaiMonthStartMs(nowMs);
      break;
  }

  return {
    start: rangeStartMs,
    end: nowMs,
  };
}

/**
 * 构建与当前区间连续的上一段等长时间窗口，用于环比计算。
 * 对于 season 周期，取上一个自然季度而非简单等长偏移，
 * 避免跨季度边界时对比区间偏移到非整季区间。
 */
export function buildPreviousSequentialRange(
  currentRange: TimeRange,
  period?: PulseHomeRevenuePeriodValue,
): TimeRange {
  if (period === HOME_REVENUE_PERIOD_SEASON) {
    return buildPreviousSeasonRange(currentRange);
  }

  const rangeMs = currentRange.end - currentRange.start + 1;
  return {
    start: currentRange.start - rangeMs,
    end: currentRange.start - 1,
  };
}

/**
 * 构建上一个自然季度的对比区间。
 * 以当前季度的起始月为基准，往前推一个季度（3 个月），
 * 确保对比区间始终对齐自然季度边界。
 */
function buildPreviousSeasonRange(currentRange: TimeRange): TimeRange {
  // 上海时区下前推 3 个月，得到上一个自然季度起点。
  const prevQuarterStart = addShanghaiMonths(currentRange.start, -3);

  // 上个季度的结束时间是当前季度的开始时刻 -1 毫秒
  const prevQuarterEnd = currentRange.start - 1;

  return {
    start: prevQuarterStart,
    end: prevQuarterEnd,
  };
}

export function buildSingleDayRange(dateText: string): TimeRange {
  const dayStart = getShanghaiDayStartMs(parseDateText(dateText).getTime());
  return {
    start: dayStart,
    end: dayStart + DAY_MS - 1,
  };
}

export function buildDateRange(startText: string, endText: string): TimeRange {
  const startMs = parseDateText(startText).getTime();
  const endMs = parseDateText(endText).getTime();
  const rangeStart = getShanghaiDayStartMs(Math.min(startMs, endMs));
  const rangeEnd = getShanghaiDayStartMs(Math.max(startMs, endMs));
  return {
    start: rangeStart,
    end: rangeEnd + DAY_MS - 1,
  };
}

export function parseDateText(dateText: string): Date {
  const parsedMs = parseShanghaiDateText(dateText);
  if (Number.isNaN(parsedMs)) {
    return new Date(dateText);
  }
  return new Date(parsedMs);
}

export function isTimeInRange(date: Date, range: TimeRange): boolean {
  const time = date.getTime();
  return time >= range.start && time <= range.end;
}

export function getInclusiveDayCount(range: TimeRange): number {
  const startDay = getShanghaiDayStartMs(range.start);
  const endDay = getShanghaiDayStartMs(range.end);
  return Math.max(1, Math.round((endDay - startDay) / DAY_MS) + 1);
}

function getStartOfDay(ts: number): number {
  return getShanghaiDayStartMs(ts);
}

function getStartOfWeek(dayStart: number): number {
  return getShanghaiWeekStartMs(dayStart);
}

function getStartOfMonth(dayStart: number): number {
  return getShanghaiMonthStartMs(dayStart);
}

function getStartOfYear(dayStart: number): number {
  return getShanghaiYearStartMs(dayStart);
}

export function formatDateLabel(date: Date): string {
  return formatShanghaiDayLabel(getShanghaiDayStartMs(date.getTime()));
}
