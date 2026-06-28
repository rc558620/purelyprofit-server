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
  const parsedDate = new Date(year, month - 1, day);

  if (
    Number.isNaN(parsedDate.getTime()) ||
    parsedDate.getFullYear() !== year ||
    parsedDate.getMonth() !== month - 1 ||
    parsedDate.getDate() !== day
  ) {
    return null;
  }

  return parsedDate;
}

export function resolveRegionCity(region: string[]): string {
  if (region.length >= 2) {
    return region[1] ?? region[0] ?? '--';
  }

  return region[0] ?? '--';
}

// maskPhone 已移除：purelyPulse 为商家管理后台，需完整展示用户手机号，不再脱敏。

export function formatDateTime(date: Date): string {
  if (Number.isNaN(date.getTime()) || date.getTime() <= 0) {
    return '--';
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hour}:${minute}`;
}
