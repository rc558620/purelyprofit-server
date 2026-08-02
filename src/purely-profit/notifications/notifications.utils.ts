import {
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from './notifications.constants';
import {
  getDayEndTimestamp,
  resolvePagination,
} from '../commerce/commerce.utils';
import {
  formatShanghaiDayLabel,
  formatShanghaiTime,
} from '../../shared/shanghai-time.utils';

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
  return formatShanghaiDayLabel(timestamp);
}

export function formatMonthDayTime(timestamp: number): string {
  return `${formatShanghaiDayLabel(timestamp)} ${formatShanghaiTime(timestamp)}`;
}

export function formatMoney(amount: number): string {
  return `¥${amount.toFixed(2)}`;
}
