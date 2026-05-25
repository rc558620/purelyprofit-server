import {
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from './notifications.constants';

export function normalizePage(page: number | undefined): number {
  if (!page || page < 1) {
    return DEFAULT_PAGE;
  }

  return page;
}

export function normalizePageSize(pageSize: number | undefined): number {
  if (!pageSize || pageSize < 1) {
    return DEFAULT_PAGE_SIZE;
  }

  return Math.min(pageSize, MAX_PAGE_SIZE);
}

export function getDayEnd(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(23, 59, 59, 999);
  return date.getTime();
}

export function formatMonthDay(timestamp: number): string {
  const date = new Date(timestamp);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${month}/${day}`;
}

export function formatMonthDayTime(timestamp: number): string {
  const date = new Date(timestamp);
  const monthDay = formatMonthDay(timestamp);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${monthDay} ${hours}:${minutes}`;
}

export function formatMoney(amount: number): string {
  return `¥${amount.toFixed(2)}`;
}
