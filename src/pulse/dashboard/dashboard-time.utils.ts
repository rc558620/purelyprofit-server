import type { PulseDashboardPeriodValue } from './dto/pulse-dashboard-query.dto';

const DAY_MS = 86_400_000;

export interface TimeRange {
  start: number;
  end: number;
}

export function buildCurrentRange(
  period: PulseDashboardPeriodValue,
): TimeRange {
  const now = Date.now();
  const todayStart = getDayStart(now);

  switch (period) {
    case 'today':
      return { start: todayStart, end: now };
    case 'week':
      return { start: getWeekStart(todayStart), end: now };
    case 'month':
      return { start: getMonthStart(todayStart), end: now };
    case 'year':
      return { start: getYearStart(todayStart), end: now };
  }
}

export function buildCompareRange(
  period: PulseDashboardPeriodValue,
  current: TimeRange,
): TimeRange {
  const duration = current.end - current.start;
  switch (period) {
    case 'today':
      return { start: current.start - DAY_MS, end: current.end - DAY_MS };
    case 'week':
      return {
        start: current.start - DAY_MS * 7,
        end: current.end - DAY_MS * 7,
      };
    case 'month': {
      const d = new Date(current.start);
      d.setMonth(d.getMonth() - 1);
      return { start: d.getTime(), end: d.getTime() + duration };
    }
    case 'year': {
      const d = new Date(current.start);
      d.setFullYear(d.getFullYear() - 1);
      return { start: d.getTime(), end: d.getTime() + duration };
    }
  }
}

function getDayStart(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function getWeekStart(todayStart: number): number {
  const d = new Date(todayStart);
  const dayOfWeek = d.getDay(); // 0=Sunday
  const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // 以周一为起点
  d.setDate(d.getDate() - diff);
  return d.getTime();
}

function getMonthStart(todayStart: number): number {
  const d = new Date(todayStart);
  d.setDate(1);
  return d.getTime();
}

function getYearStart(todayStart: number): number {
  const d = new Date(todayStart);
  d.setMonth(0, 1);
  return d.getTime();
}

export function formatDateLabel(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${month}/${day}`;
}
