import {
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from './notifications.constants';
import {
  getDayEndTimestamp,
  resolvePagination,
} from '../commerce/commerce.utils';

/** 获取某天 23:59:59.999 的时间戳 */
export function getDayEnd(timestamp: number): number {
  return getDayEndTimestamp(timestamp);
}

export function normalizePage(page: number | undefined): number {
  return resolvePagination(page, undefined, DEFAULT_PAGE, MAX_PAGE_SIZE).page;
}

export function normalizePageSize(pageSize: number | undefined): number {
  return resolvePagination(
    undefined,
    pageSize,
    DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE,
  ).take;
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
