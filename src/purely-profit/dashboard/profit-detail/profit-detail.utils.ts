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
  ProfitClampedRanges,
  ProfitDateRange,
  ProfitDetailQueryInput,
} from './profit-detail.types';

const DAY_MS = 86_400_000;
/** 自定义区间最大跨度（10 年）：防止异常入参生成超大聚合窗口 */
const MAX_RANGE_SPAN_MS = 10 * 366 * DAY_MS;
const MIN_YEAR = 1970;
const MAX_YEAR = 9999;

/**
 * 时间戳必须能被 Date 表示。
 *
 * DTO 已加 @Max 兜底，但 buildQueryInput 也被缓存预热等内部调用复用，
 * 这里再做一次防御：超出 ±8.64e15 的入参会得到 Invalid Date，
 * 一路传到 Prisma 就是 500，应该在进入查库前变成 400。
 */
function assertValidTimestamp(value: number | undefined, label: string): void {
  if (value === undefined) {
    return;
  }

  if (!Number.isFinite(value) || !Number.isFinite(new Date(value).getTime())) {
    throw new BadRequestException(`${label}不合法`);
  }
}

function assertQueryInput(query: ProfitDetailQueryInput): void {
  if (
    query.year !== undefined &&
    (query.year < MIN_YEAR || query.year > MAX_YEAR)
  ) {
    throw new BadRequestException('年份不合法');
  }

  assertValidTimestamp(query.customDate, '自定义日期');
  assertValidTimestamp(query.rangeStartDate, '区间开始时间');
  assertValidTimestamp(query.rangeEndDate, '区间结束时间');
  assertValidTimestamp(query.startTime, '开始时间');
  assertValidTimestamp(query.endTime, '结束时间');
}

export function buildQueryInput(
  queryDto: GetProfitDetailQueryDto,
): ProfitDetailQueryInput {
  const query: ProfitDetailQueryInput = {
    storeId: queryDto.storeId,
    period: queryDto.period,
    year: queryDto.year,
    customDate: queryDto.customDate,
    rangeStartDate: queryDto.rangeStartDate,
    rangeEndDate: queryDto.rangeEndDate,
    startTime: queryDto.startTime,
    endTime: queryDto.endTime,
  };
  assertQueryInput(query);
  return query;
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
      if (endDate - startDate > MAX_RANGE_SPAN_MS) {
        throw new BadRequestException('自定义区间跨度不能超过 10 年');
      }
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

export async function buildClampedRanges(
  platformMembershipAccessService: PlatformMembershipAccessService,
  storeId: number,
  currentRange: ProfitDateRange,
  previousRange: ProfitDateRange,
  callerIsSubAccount = false,
): Promise<ProfitClampedRanges> {
  // 两个区间共用一次会员档案读取，避免同一请求回表两次。
  const clamper =
    await platformMembershipAccessService.createHistoryRangeClamper(
      storeId,
      callerIsSubAccount,
    );

  return {
    currentRange: clamper.clamp(currentRange),
    previousRange: clamper.clamp(previousRange),
  };
}
