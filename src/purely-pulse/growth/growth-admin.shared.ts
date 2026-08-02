import {
  formatShanghaiDateTime,
  getShanghaiDayOfMonth,
  getShanghaiMonth,
  getShanghaiYear,
  makeShanghaiMs,
} from '../../shared/shanghai-time.utils';

export function parseDateOnly(value: string): Date | null {
  const normalizedValue = value.trim().replace(/\./g, '-').replace(/\//g, '-');
  const matched = normalizedValue.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!matched) {
    return null;
  }

  const [, yearText, monthText, dayText] = matched;
  const year = Number.parseInt(yearText, 10);
  const month = Number.parseInt(monthText, 10);
  const day = Number.parseInt(dayText, 10);
  // 日期串按上海时区解释为当日零点
  const parsedMs = makeShanghaiMs(year, month - 1, day);

  // 校验溢出（如 2-30 会被进位到 3-2），需按上海时区回读比对
  if (
    Number.isNaN(parsedMs) ||
    getShanghaiYear(parsedMs) !== year ||
    getShanghaiMonth(parsedMs) !== month - 1 ||
    getShanghaiDayOfMonth(parsedMs) !== day
  ) {
    return null;
  }

  return new Date(parsedMs);
}

export function resolveRegionCity(region: string[]): string {
  if (region.length >= 2) {
    return region[1] ?? region[0] ?? '--';
  }

  return region[0] ?? '--';
}

// maskPhone 已移除：purelyPulse 为商家管理后台，需完整展示用户手机号，不再脱敏。
// maskIdCard 已移除：purelyPulse 合伙人审核页需查看完整身份证号，不再脱敏。

export function formatDateTime(date: Date): string {
  if (Number.isNaN(date.getTime()) || date.getTime() <= 0) {
    return '--';
  }

  return formatShanghaiDateTime(date.getTime());
}
