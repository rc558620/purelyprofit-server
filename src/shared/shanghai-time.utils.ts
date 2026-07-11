/**
 * 上海时区（UTC+8）时间边界工具。
 *
 * 业务日/月/周/年边界统一以上海本地时区为准，且不依赖运行进程时区
 * （避免容器 UTC 部署下与显式上海时区口径错位）。
 *
 * 实现约定：先把任意 UTC 毫秒瞬间平移 +8h，用 UTC getter/setter 当作
 * “上海墙钟”读写，最后再 -8h 还原为真实 UTC 毫秒瞬间，保证结果与时区无关。
 */

const SHANGHAI_OFFSET_MS = 8 * 60 * 60_000;
const DAY_MS = 86_400_000;

/** 计算任意 UTC 毫秒瞬间所属的上海本地日零点（返回 UTC 毫秒瞬间）。 */
export function getShanghaiDayStartMs(timestampMs: number): number {
  const shanghaiLocalMs = timestampMs + SHANGHAI_OFFSET_MS;
  const shanghaiDayMs = Math.floor(shanghaiLocalMs / DAY_MS) * DAY_MS;
  return shanghaiDayMs - SHANGHAI_OFFSET_MS;
}

/** 上海本地日终点的 UTC 毫秒瞬间（当日 23:59:59.999）。 */
export function getShanghaiDayEndMs(timestampMs: number): number {
  return getShanghaiDayStartMs(timestampMs) + DAY_MS - 1;
}

/** 将上海本地日零点 UTC 毫秒格式化为 `MM/DD` 标签。 */
export function formatShanghaiDayLabel(shanghaiDayStartMs: number): string {
  const date = new Date(shanghaiDayStartMs + SHANGHAI_OFFSET_MS);
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${month}/${day}`;
}

/** 读取任意 UTC 毫秒瞬间在上海本地时区下的星期几（0=周日…6=周六）。 */
export function getShanghaiWeekday(utcMs: number): number {
  return new Date(utcMs + SHANGHAI_OFFSET_MS).getUTCDay();
}

/** 上海时区「本周一 00:00」对应的 UTC 毫秒（周一为周起始）。 */
export function getShanghaiWeekStartMs(now: number): number {
  const todayShanghai = getShanghaiDayStartMs(now);
  const weekday = getShanghaiWeekday(todayShanghai);
  const diffToMonday = weekday === 0 ? -6 : 1 - weekday;
  return todayShanghai + diffToMonday * DAY_MS;
}

/** 上海时区「本月 1 日 00:00」对应的 UTC 毫秒。 */
export function getShanghaiMonthStartMs(now: number): number {
  const shanghai = new Date(now + SHANGHAI_OFFSET_MS);
  shanghai.setUTCDate(1);
  shanghai.setUTCHours(0, 0, 0, 0);
  return shanghai.getTime() - SHANGHAI_OFFSET_MS;
}

/** 上海时区「本季度首月 1 日 00:00」对应的 UTC 毫秒。 */
export function getShanghaiQuarterStartMs(now: number): number {
  const shanghai = new Date(now + SHANGHAI_OFFSET_MS);
  const quarter = Math.floor(shanghai.getUTCMonth() / 3);
  shanghai.setUTCMonth(quarter * 3, 1);
  shanghai.setUTCHours(0, 0, 0, 0);
  return shanghai.getTime() - SHANGHAI_OFFSET_MS;
}

/** 上海时区「本年 1 月 1 日 00:00」对应的 UTC 毫秒（基于当前瞬间所在年）。 */
export function getShanghaiYearStartMs(now: number): number {
  const shanghai = new Date(now + SHANGHAI_OFFSET_MS);
  shanghai.setUTCMonth(0, 1);
  shanghai.setUTCHours(0, 0, 0, 0);
  return shanghai.getTime() - SHANGHAI_OFFSET_MS;
}

/** 指定年份的上海时区「1 月 1 日 00:00」对应的 UTC 毫秒。 */
export function getShanghaiYearStartMsForYear(year: number): number {
  return Date.UTC(year, 0, 1, 0, 0, 0, 0) - SHANGHAI_OFFSET_MS;
}

/** 指定年份的上海时区「12 月 31 日 23:59:59.999」对应的 UTC 毫秒。 */
export function getShanghaiYearEndMsForYear(year: number): number {
  return Date.UTC(year, 11, 31, 23, 59, 59, 999) - SHANGHAI_OFFSET_MS;
}

/** 从上海本地日零点（UTC 毫秒）提取上海墙钟的月份下标（0-11），与时区无关。 */
export function getShanghaiMonthIndex(shanghaiDayStartMs: number): number {
  return new Date(shanghaiDayStartMs + SHANGHAI_OFFSET_MS).getUTCMonth();
}

/** 从上海本地日零点（UTC 毫秒）提取上海墙钟的年份，与时区无关。 */
export function getShanghaiFullYear(shanghaiDayStartMs: number): number {
  return new Date(shanghaiDayStartMs + SHANGHAI_OFFSET_MS).getUTCFullYear();
}

/** 读取任意 UTC 毫秒瞬间在上海本地时区下的小时（0-23）。 */
export function getShanghaiHour(timestampMs: number): number {
  return new Date(timestampMs + SHANGHAI_OFFSET_MS).getUTCHours();
}

/** 指定年月的上海时区「当月 1 日 00:00」对应的 UTC 毫秒（monthIndex 为 0-11）。 */
export function getShanghaiMonthStartMsForYearMonth(
  year: number,
  monthIndex: number,
): number {
  return Date.UTC(year, monthIndex, 1, 0, 0, 0, 0) - SHANGHAI_OFFSET_MS;
}

/** 由上海墙钟的年/月（0-11）生成 `YYYY/MM` 标签，与时区无关。 */
export function formatYearMonthKeyFromYm(
  year: number,
  monthIndex: number,
): string {
  return `${year}/${String(monthIndex + 1).padStart(2, '0')}`;
}
