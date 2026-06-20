export function getDayStart(timestamp: number): number {
  const current = new Date(timestamp);
  current.setHours(0, 0, 0, 0);
  return current.getTime();
}

export function getDayEnd(timestamp: number): number {
  const current = new Date(timestamp);
  current.setHours(23, 59, 59, 999);
  return current.getTime();
}

export function formatReportDateLabel(timestamp: number): string {
  const current = new Date(timestamp);
  const year = current.getFullYear();
  const month = String(current.getMonth() + 1).padStart(2, '0');
  const day = String(current.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatMonthDay(timestamp: number): string {
  const current = new Date(timestamp);
  const month = String(current.getMonth() + 1).padStart(2, '0');
  const day = String(current.getDate()).padStart(2, '0');
  return `${month}/${day}`;
}

export function getWeekStart(current: Date): number {
  const day = current.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(current);
  monday.setDate(current.getDate() + diff);
  monday.setHours(0, 0, 0, 0);
  return monday.getTime();
}
