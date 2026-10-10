import { BadRequestException } from '@nestjs/common';
import type { PlatformMembershipAccessService } from '../../member/platform-membership/platform-membership-access.service';
import { buildPreviousRangeByDuration } from '../../commerce/commerce.utils';
import {
  getShanghaiDayEndMs,
  getShanghaiDayStartMs,
  getShanghaiFullYear,
  getShanghaiMonthStartMs,
  getShanghaiQuarterStartMs,
  getShanghaiWeekStartMs,
  getShanghaiYearEndMsForYear,
  getShanghaiYearStartMsForYear,
} from '../../../shared/shanghai-time.utils';
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
        start: getShanghaiDayStartMs(now),
        end: now,
      };
    case 'week':
      return {
        start: getShanghaiWeekStartMs(now),
        end: now,
      };
    case 'month':
      return {
        start: getShanghaiMonthStartMs(now),
        end: now,
      };
    case 'quarter':
      return {
        start: getShanghaiQuarterStartMs(now),
        end: now,
      };
    case 'year': {
      const year = query.year ?? getShanghaiFullYear(Date.now());
      return {
        start: getShanghaiYearStartMsForYear(year),
        end: getShanghaiYearEndMsForYear(year),
      };
    }
    case 'custom_month': {
      const customDate = query.customDate ?? query.startTime;

      if (customDate === undefined) {
        throw new BadRequestException(
          '自定义单日模式需要传 customDate 或 startTime',
        );
      }
      return {
        start: getShanghaiDayStartMs(customDate),
        end: getShanghaiDayEndMs(customDate),
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
        start: getShanghaiDayStartMs(startDate),
        end: getShanghaiDayEndMs(endDate),
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
    const previousYear = getShanghaiFullYear(currentRange.start) - 1;
    return {
      start: getShanghaiYearStartMsForYear(previousYear),
      end: getShanghaiYearEndMsForYear(previousYear),
    };
  }

  return buildPreviousRangeByDuration(currentRange.start, currentRange.end);
}

export function resolveProfitQueryRange(
  currentRange: ProfitAccessibleRange,
  previousRange: ProfitAccessibleRange,
): ProfitDateRange {
  // end 取两侧最大值（与 business-analysis 的 resolveAnalysisQueryRange 对齐）：
  // 仅取 currentRange.end 时，一旦历史裁剪让上期末端超出当期，上期尾部的销售/成本行
  // 会被整体漏查，导致 previousRevenue/previousCost 偏小、环比虚高。
  return {
    start: previousRange.empty
      ? currentRange.start
      : Math.min(currentRange.start, previousRange.start),
    end: previousRange.empty
      ? currentRange.end
      : Math.max(currentRange.end, previousRange.end),
  };
}

export async function buildClampedRanges(
  platformMembershipAccessService: PlatformMembershipAccessService,
  storeId: number,
  currentRange: ProfitDateRange,
  previousRange: ProfitDateRange,
  callerIsSubAccount = false,
): Promise<ProfitClampedRanges> {
  const [clampedCurrentRange, clampedPreviousRange] = await Promise.all([
    platformMembershipAccessService.clampHistoryRange(
      storeId,
      currentRange,
      callerIsSubAccount,
    ),
    platformMembershipAccessService.clampHistoryRange(
      storeId,
      previousRange,
      callerIsSubAccount,
    ),
  ]);

  return {
    currentRange: clampedCurrentRange,
    previousRange: clampedPreviousRange,
  };
}
