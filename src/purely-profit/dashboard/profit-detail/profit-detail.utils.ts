import { BadRequestException } from '@nestjs/common';
import type { PlatformMembershipAccessService } from '../../member/platform-membership/platform-membership-access.service';
import {
  buildPreviousRangeByDuration,
  getDayEndTimestamp,
  getDayStartTimestamp,
  getMonthStartTimestamp,
  getQuarterStartTimestamp,
  getWeekStartTimestamp,
  subtractMoneyValues,
} from '../../commerce/commerce.utils';
import { GetProfitDetailQueryDto } from './dto/profit-detail-query.dto';
import type {
  ProfitAccessibleRange,
  ProfitClampedRanges,
  ProfitDateRange,
  ProfitDetailQueryInput,
} from './profit-detail.types';

export function buildQueryInput(
  queryDto: GetProfitDetailQueryDto,
): ProfitDetailQueryInput {
  return {
    storeId: queryDto.storeId,
    period: queryDto.period,
    year: queryDto.year,
    customDate: queryDto.customDate,
    rangeStartDate: queryDto.rangeStartDate,
    rangeEndDate: queryDto.rangeEndDate,
    startTime: queryDto.startTime,
    endTime: queryDto.endTime,
  };
}

export function buildCurrentRange(
  query: ProfitDetailQueryInput,
): ProfitDateRange {
  const period = query.period ?? 'month';
  const now = Date.now();

  switch (period) {
    case 'today':
      return {
        start: getDayStartTimestamp(now),
        end: now,
      };
    case 'week':
      return {
        start: getWeekStartTimestamp(now),
        end: now,
      };
    case 'month':
      return {
        start: getMonthStartTimestamp(now),
        end: now,
      };
    case 'quarter':
      return {
        start: getQuarterStartTimestamp(now),
        end: now,
      };
    case 'year': {
      const year = query.year ?? new Date().getFullYear();
      return {
        start: new Date(year, 0, 1, 0, 0, 0, 0).getTime(),
        end: new Date(year, 11, 31, 23, 59, 59, 999).getTime(),
      };
    }
    case 'custom_month': {
      const customDate =
        query.customDate ??
        query.startTime ??
        query.rangeStartDate ??
        query.rangeEndDate ??
        query.endTime;

      if (customDate === undefined) {
        throw new BadRequestException(
          '自定义单日模式需要传 customDate 或 startTime',
        );
      }
      return {
        start: getDayStartTimestamp(customDate),
        end: getDayEndTimestamp(customDate),
      };
    }
    case 'custom_range': {
      const rangeStartDate = query.rangeStartDate ?? query.startTime;
      const rangeEndDate = query.rangeEndDate ?? query.endTime;

      if (rangeStartDate === undefined || rangeEndDate === undefined) {
        throw new BadRequestException(
          '自定义区间模式需要传 rangeStartDate/rangeEndDate 或 startTime/endTime',
        );
      }
      const startDate = Math.min(rangeStartDate, rangeEndDate);
      const endDate = Math.max(rangeStartDate, rangeEndDate);
      return {
        start: getDayStartTimestamp(startDate),
        end: getDayEndTimestamp(endDate),
      };
    }
    default:
      throw new BadRequestException('利润时间周期不合法');
  }
}

export function buildPreviousRange(
  query: ProfitDetailQueryInput,
  currentRange: ProfitDateRange,
): ProfitDateRange {
  if ((query.period ?? 'month') === 'year') {
    const previousYear = new Date(currentRange.start).getFullYear() - 1;
    return {
      start: new Date(previousYear, 0, 1, 0, 0, 0, 0).getTime(),
      end: new Date(previousYear, 11, 31, 23, 59, 59, 999).getTime(),
    };
  }

  return buildPreviousRangeByDuration(currentRange.start, currentRange.end);
}

export function resolveProfitQueryRange(
  currentRange: ProfitAccessibleRange,
  previousRange: ProfitAccessibleRange,
): ProfitDateRange {
  return {
    start: previousRange.empty
      ? currentRange.start
      : Math.min(currentRange.start, previousRange.start),
    end: currentRange.end,
  };
}

export async function buildClampedRanges(
  platformMembershipAccessService: PlatformMembershipAccessService,
  storeId: number,
  currentRange: ProfitDateRange,
  previousRange: ProfitDateRange,
): Promise<ProfitClampedRanges> {
  const [clampedCurrentRange, clampedPreviousRange] = await Promise.all([
    platformMembershipAccessService.clampHistoryRange(storeId, currentRange),
    platformMembershipAccessService.clampHistoryRange(storeId, previousRange),
  ]);

  return {
    currentRange: clampedCurrentRange,
    previousRange: clampedPreviousRange,
  };
}

export function subtractMoney(left: number, right: number): number {
  return subtractMoneyValues(left, right);
}
