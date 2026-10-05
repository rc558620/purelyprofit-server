import { formatMonthDayLabel } from '../../commerce/commerce.utils';
import { Money } from '../../../shared/money.utils';

/*
 * toTimestamp 已上提到共享层（缓存回读的日期字段是字符串，需统一容错转换）。
 * 这里保留 re-export，使既有 import 路径不受影响。
 */
export { toTimestamp } from '../../../shared/date-coerce.utils';
import { toTimestamp } from '../../../shared/date-coerce.utils';

export function formatMoneyText(value: number): string {
  return Money.fromInputYuan(value)
    .toOutputYuan()
    .toFixed(2)
    .replace(/\.00$/, '')
    .replace(/(\.\d)0$/, '$1');
}

export function formatSignedPercent(value: number): string {
  const formatted = formatMoneyText(Math.abs(value));
  return `${value > 0 ? '+' : '-'}${formatted}%`;
}

export function formatRelativeTime(timestamp: number, now: number): string {
  const diff = Math.max(now - timestamp, 0);
  const minute = 60 * 1000;
  const hour = 60 * minute;

  if (diff < minute) {
    return '刚刚';
  }

  if (diff < hour) {
    return `${Math.max(1, Math.floor(diff / minute))}分钟前`;
  }

  if (diff < 24 * hour) {
    return `${Math.max(1, Math.floor(diff / hour))}小时前`;
  }

  const days = Math.max(1, Math.floor(diff / (24 * hour)));
  if (days < 30) {
    return `${days}天前`;
  }

  return formatMonthDayLabel(timestamp);
}
