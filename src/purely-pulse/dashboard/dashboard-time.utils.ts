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

export const DAY_MS = 86_400_000;

export interface TimeRange {
  start: number;
  end: number;
}

export function buildCurrentRange(
  period: PulseDashboardPeriodValue,
): TimeRange {
  const now = Date.now();
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
      const compareStart = new Date(current.start);
      compareStart.setMonth(compareStart.getMonth() - 1);
      return {
        start: compareStart.getTime(),
        end: compareStart.getTime() + currentDuration,
      };
    }
    case DASHBOARD_PERIOD_YEAR: {
      const compareStart = new Date(current.start);
      compareStart.setFullYear(compareStart.getFullYear() - 1);
      return {
        start: compareStart.getTime(),
        end: compareStart.getTime() + currentDuration,
      };
    }
  }
}

export function buildHomeRevenueRange(
  period: PulseHomeRevenuePeriodValue,
  now: Date,
): TimeRange {
  let rangeStartDate: Date;

  // Home / revenue-detail share the revenue period semantics.
  switch (period) {
    case DASHBOARD_PERIOD_TODAY:
      rangeStartDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      break;
    case DASHBOARD_PERIOD_WEEK: {
      rangeStartDate = new Date(now);
      const dayOfWeek =
        rangeStartDate.getDay() === 0 ? 6 : rangeStartDate.getDay() - 1;
      rangeStartDate.setDate(rangeStartDate.getDate() - dayOfWeek);
      rangeStartDate.setHours(0, 0, 0, 0);
      break;
    }
    case HOME_REVENUE_PERIOD_SEASON: {
      const seasonStartMonth = Math.floor(now.getMonth() / 3) * 3;
      rangeStartDate = new Date(now.getFullYear(), seasonStartMonth, 1);
      break;
    }
    case DASHBOARD_PERIOD_MONTH:
    default:
      rangeStartDate = new Date(now.getFullYear(), now.getMonth(), 1);
      break;
  }

  return {
    start: rangeStartDate.getTime(),
    end: now.getTime(),
  };
}

export function buildPreviousSequentialRange(currentRange: TimeRange): TimeRange {
  const rangeMs = currentRange.end - currentRange.start + 1;
  return {
    start: currentRange.start - rangeMs,
    end: currentRange.start - 1,
  };
}

export function buildSingleDayRange(dateText: string): TimeRange {
  const date = parseDateText(dateText);
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const end = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    23,
    59,
    59,
    999,
  );
  return {
    start: start.getTime(),
    end: end.getTime(),
  };
}

export function buildDateRange(startText: string, endText: string): TimeRange {
  const startDate = parseDateText(startText);
  const endDate = parseDateText(endText);
  const rangeStart = new Date(Math.min(startDate.getTime(), endDate.getTime()));
  const rangeEnd = new Date(Math.max(startDate.getTime(), endDate.getTime()));
  rangeStart.setHours(0, 0, 0, 0);
  rangeEnd.setHours(23, 59, 59, 999);
  return {
    start: rangeStart.getTime(),
    end: rangeEnd.getTime(),
  };
}

export function parseDateText(dateText: string): Date {
  const normalizedText = dateText.trim().replace(/\./g, '/').replace(/-/g, '/');
  const [yearText, monthText, dayText] = normalizedText.split('/');
  const year = Number.parseInt(yearText ?? '', 10);
  const month = Number.parseInt(monthText ?? '', 10);
  const day = Number.parseInt(dayText ?? '', 10);

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day)
  ) {
    return new Date(dateText);
  }

  return new Date(year, month - 1, day);
}

export function isTimeInRange(date: Date, range: TimeRange): boolean {
  const time = date.getTime();
  return time >= range.start && time <= range.end;
}

export function getInclusiveDayCount(range: TimeRange): number {
  const start = new Date(range.start);
  const end = new Date(range.end);
  const startDay = new Date(
    start.getFullYear(),
    start.getMonth(),
    start.getDate(),
  ).getTime();
  const endDay = new Date(
    end.getFullYear(),
    end.getMonth(),
    end.getDate(),
  ).getTime();
  return Math.max(1, Math.floor((endDay - startDay) / DAY_MS) + 1);
}

function getStartOfDay(ts: number): number {
  const date = new Date(ts);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function getStartOfWeek(dayStart: number): number {
  const date = new Date(dayStart);
  const dayOfWeek = date.getDay();
  const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  date.setDate(date.getDate() - diff);
  return date.getTime();
}

function getStartOfMonth(dayStart: number): number {
  const date = new Date(dayStart);
  date.setDate(1);
  return date.getTime();
}

function getStartOfYear(dayStart: number): number {
  const date = new Date(dayStart);
  date.setMonth(0, 1);
  return date.getTime();
}

export function formatDateLabel(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${month}/${day}`;
}
