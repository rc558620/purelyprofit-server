import { BadRequestException, Logger } from '@nestjs/common';
import { buildPreviousRangeByDuration } from '../../commerce/commerce.utils';
import type {
  BusinessAnalysisAccessibleRange,
  BusinessAnalysisPeriod,
  BusinessAnalysisRange,
  BusinessAnalysisRangeQuery,
} from './business-analysis.types';

const SHANGHAI_OFFSET_MS = 8 * 60 * 60_000;
const DAY_MS = 86_400_000;
const logger = new Logger('BusinessAnalysisUtils');

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

export function resolveCurrentRange(
  query: BusinessAnalysisRangeQuery,
  now: number = Date.now(),
): BusinessAnalysisRange {
  if (query.startTime !== undefined || query.endTime !== undefined) {
    if (query.startTime === undefined || query.endTime === undefined) {
      throw new BadRequestException('开始和结束时间必须同时传入');
    }

    if (query.endTime < query.startTime) {
      throw new BadRequestException('结束时间不能早于开始时间');
    }

    return {
      start: query.startTime,
      end: query.endTime,
    };
  }

  if (query.period === 'custom_range') {
    throw new BadRequestException('自定义周期必须传开始和结束时间');
  }

  return resolvePresetRange(query.period, now);
}

export function getPreviousRange(
  start: number,
  end: number,
): BusinessAnalysisRange {
  return buildPreviousRangeByDuration(start, end);
}

export function resolveAnalysisQueryRange(
  currentRange: BusinessAnalysisAccessibleRange,
  previousRange: BusinessAnalysisAccessibleRange,
): BusinessAnalysisRange {
  const start = previousRange.empty
    ? currentRange.start
    : Math.min(currentRange.start, previousRange.start);
  const end = previousRange.empty
    ? currentRange.end
    : Math.max(currentRange.end, previousRange.end);
  return { start, end };
}

/**
 * 读取某个 UTC 毫秒时间戳在上海本地时区下的星期几（0=周日…6=周六）。
 * 等价于先把该瞬间平移到上海墙钟，再用 UTC getter 读取，避免依赖进程本地时区。
 */
function getShanghaiWeekday(utcMs: number): number {
  return new Date(utcMs + SHANGHAI_OFFSET_MS).getUTCDay();
}

/** 上海时区的「本周一 00:00」对应的 UTC 毫秒（周一为周起始）。 */
function getShanghaiWeekStartMs(now: number): number {
  const todayShanghai = getShanghaiDayStartMs(now);
  const weekday = getShanghaiWeekday(todayShanghai);
  const diffToMonday = weekday === 0 ? -6 : 1 - weekday;
  return todayShanghai + diffToMonday * DAY_MS;
}

/** 上海时区的「本月 1 日 00:00」对应的 UTC 毫秒。 */
export function getShanghaiMonthStartMs(now: number): number {
  const shanghai = new Date(now + SHANGHAI_OFFSET_MS);
  shanghai.setUTCDate(1);
  shanghai.setUTCHours(0, 0, 0, 0);
  return shanghai.getTime() - SHANGHAI_OFFSET_MS;
}

/** 上海时区的「本季度首月 1 日 00:00」对应的 UTC 毫秒。 */
function getShanghaiQuarterStartMs(now: number): number {
  const shanghai = new Date(now + SHANGHAI_OFFSET_MS);
  const quarter = Math.floor(shanghai.getUTCMonth() / 3);
  shanghai.setUTCMonth(quarter * 3, 1);
  shanghai.setUTCHours(0, 0, 0, 0);
  return shanghai.getTime() - SHANGHAI_OFFSET_MS;
}

/**
 * 所有预设周期统一使用上海本地时区计算起始边界，与 SQL 日桶
 * （`date_trunc('day', col + interval '8 hours') - interval '8 hours'`）
 * 及 `getShanghaiDayStartMs` 保持一致；避免服务进程时区非 Asia/Shanghai 时，
 * 周/月/季/年边界与日趋势桶错位，导致 heroSummary 汇总与 dailyTrend 口径不一致。
 */
function resolvePresetRange(
  period: Exclude<BusinessAnalysisPeriod, 'custom_range'>,
  now: number,
): BusinessAnalysisRange {
  // 预设周期的 end 取 now（截至目前），而非当天/周/月/季/年末，
  // 保证返回的是实时数据快照。前端如需全天数据应使用 custom_range + endTime 传当天末毫秒。
  switch (period) {
    case 'today':
      return { start: getShanghaiDayStartMs(now), end: now };
    case 'week':
      return { start: getShanghaiWeekStartMs(now), end: now };
    case 'month':
      return { start: getShanghaiMonthStartMs(now), end: now };
    case 'quarter':
      return { start: getShanghaiQuarterStartMs(now), end: now };
    case 'year': {
      const shanghai = new Date(now + SHANGHAI_OFFSET_MS);
      shanghai.setUTCMonth(0, 1);
      shanghai.setUTCHours(0, 0, 0, 0);
      return { start: shanghai.getTime() - SHANGHAI_OFFSET_MS, end: now };
    }
    default: {
      // 理论不可达：period 已排除 'custom_range'，且上面的 case 覆盖其余全部取值。
      // 若新增周期未在此处理，记录告警并兜底为全量区间，避免静默返回错误口径。
      logger.warn(`resolvePresetRange 命中未处理的预设周期: ${String(period)}`);
      return { start: 0, end: now };
    }
  }
}
