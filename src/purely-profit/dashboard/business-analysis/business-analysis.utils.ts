import { BadRequestException } from '@nestjs/common';
import {
  buildPreviousRangeByDuration,
  getMonthStartTimestamp,
  getQuarterStartTimestamp,
  getWeekStartTimestamp,
} from '../../commerce/commerce.utils';
import type {
  BusinessAnalysisAccessibleRange,
  BusinessAnalysisPeriod,
  BusinessAnalysisRange,
  BusinessAnalysisRangeQuery,
} from './business-analysis.types';

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
      return { start: getWeekStartTimestamp(now), end: now };
    case 'month':
      return { start: getMonthStartTimestamp(now), end: now };
    case 'quarter':
      return { start: getQuarterStartTimestamp(now), end: now };
    case 'year': {
      const current = new Date(now);
      return {
        start: new Date(current.getFullYear(), 0, 1).setHours(0, 0, 0, 0),
        end: now,
      };
    }
    default:
      return { start: 0, end: now };
  }
}
