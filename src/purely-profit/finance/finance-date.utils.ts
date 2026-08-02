import {
  formatShanghaiDate,
  formatShanghaiDateTime,
} from '../../shared/shanghai-time.utils';

const SHANGHAI_OFFSET_MS = 8 * 60 * 60_000;

/**
 * 计算任意时间戳所属的上海本地日零点（UTC 毫秒时间戳）。
 * 与 SQL 中 `date_trunc('day', col + interval '8 hours') - interval '8 hours'` 等价，
 * 不依赖 Node.js 进程本地时区，确保日趋势聚合与 SQL 桶对齐。
 */
export function getShanghaiDayStartMs(timestampMs: number): number {
  const shanghaiLocalMs = timestampMs + SHANGHAI_OFFSET_MS;
  const shanghaiDayMs = Math.floor(shanghaiLocalMs / 86_400_000) * 86_400_000;
  return shanghaiDayMs - SHANGHAI_OFFSET_MS;
}

/**
 * 将上海本地日零点 UTC 毫秒时间戳格式化为 `MM/DD` 标签。
 * 使用 UTC 方法读取月/日，不依赖 Node.js 本地时区。
 */
export function formatShanghaiDayLabel(shanghaiDayStartMs: number): string {
  const date = new Date(shanghaiDayStartMs + SHANGHAI_OFFSET_MS);
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${month}/${day}`;
}

/**
 * 获取时间戳所在上海本地月的 1 号零点（UTC 毫秒时间戳）。
 * 不依赖 Node.js 进程本地时区。
 */
export function getShanghaiMonthStartMs(timestampMs: number): number {
  const date = new Date(timestampMs + SHANGHAI_OFFSET_MS);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  // 上海月1号零点 = UTC 上月最后一天 16:00
  return Date.UTC(year, month, 1) - SHANGHAI_OFFSET_MS;
}

export function getDayStart(timestamp: number): number {
  return getShanghaiDayStartMs(timestamp);
}

export function getDayEnd(timestamp: number): number {
  return getShanghaiDayStartMs(timestamp) + 86_400_000 - 1;
}

export function formatReportDateLabel(timestamp: number): string {
  return formatShanghaiDate(timestamp);
}

/**
 * 格式化为 "YYYY-MM-DD HH:mm" 样式，用于现金流水明细等需要精确到时间的场景。
 */
export function formatReportDateTimeLabel(timestamp: number): string {
  return formatShanghaiDateTime(timestamp);
}

export function formatMonthDay(timestamp: number): string {
  // 使用上海时区格式化，与 SQL date_trunc + interval '8 hours' 对齐
  const date = new Date(timestamp + SHANGHAI_OFFSET_MS);
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${month}/${day}`;
}

/** 格式化为 "1月" 样式，用于年度月聚合趋势图 */
export function formatMonthLabel(month1Based: number): string {
  return `${month1Based}月`;
}

/** 获取时间戳所在月的 1 号零点 */
export function getMonthStart(timestamp: number): number {
  return getShanghaiMonthStartMs(timestamp);
}

/**
 * 获取上海本地周起点（周一零点，UTC 毫秒时间戳）。
 * 不依赖 Node.js 进程本地时区。
 */
export function getShanghaiWeekStartMs(timestampMs: number): number {
  const shanghaiLocalMs = timestampMs + SHANGHAI_OFFSET_MS;
  const date = new Date(shanghaiLocalMs);
  const day = date.getUTCDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  const shanghaiDayMs = Math.floor(shanghaiLocalMs / 86_400_000) * 86_400_000;
  const mondayMs = shanghaiDayMs + diff * 86_400_000;
  return mondayMs - SHANGHAI_OFFSET_MS;
}

export function getWeekStart(current: Date): number {
  return getShanghaiWeekStartMs(current.getTime());
}
