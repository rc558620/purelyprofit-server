import { BadRequestException } from '@nestjs/common';
import {
  buildPreviousRangeByDuration,
  getDayStartTimestamp,
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

  if (query.period === 'custom_month' || query.period === 'custom_range') {
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
  return {
    start: previousRange.empty
      ? currentRange.start
      : Math.min(currentRange.start, previousRange.start),
    end: currentRange.end,
  };
}

function resolvePresetRange(
  period: Exclude<BusinessAnalysisPeriod, 'custom_month' | 'custom_range'>,
  now: number,
): BusinessAnalysisRange {
  switch (period) {
    case 'today':
      return { start: getDayStartTimestamp(now), end: now };
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
