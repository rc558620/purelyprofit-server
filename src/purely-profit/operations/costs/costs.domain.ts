import { BadRequestException } from '@nestjs/common';
import { buildPurchaseDateRange } from '../../commerce/commerce.utils';
import {
  Money,
  calcPercentChangeWithFallback,
} from '../../../shared/money.utils';
import {
  formatShanghaiYearMonth,
  getShanghaiDayOfMonth,
  getShanghaiDayStartMs,
  getShanghaiMonth,
  getShanghaiMonthStartMs,
  getShanghaiQuarterStartMs,
  getShanghaiWeekStartMs,
  getShanghaiYear,
  makeShanghaiMs,
} from '../../../shared/shanghai-time.utils';
import type {
  CostAmountRow,
  CostFilterRange,
  CostQueryInput,
  CostReportQueryInput,
  CostReportRange,
} from './costs.types';
import type {
  CostDashboardResponseDto,
  CostReportResponseDto,
  CostReportSummaryDto,
  CostStatsResponseDto,
} from './dto/costs-response.dto';

export function buildEmptyCostStatsResponse(): CostStatsResponseDto {
  return {
    total: 0,
    fixed: 0,
    variable: 0,
    compareLastPeriod: null,
    recordCount: 0,
  };
}

export function buildEmptyCostReportSummary(): CostReportSummaryDto {
  return {
    total: 0,
    fixed: 0,
    variable: 0,
    fixedPercentage: 0,
    compareLastPeriod: null,
    recordCount: 0,
  };
}

export function buildEmptyCostReportResponse(): CostReportResponseDto {
  return {
    summary: buildEmptyCostReportSummary(),
    categories: [],
    detailRows: [],
  };
}

export function buildEmptyCostDashboardResponse(): CostDashboardResponseDto {
  return {
    summary: buildEmptyCostStatsResponse(),
    categories: [],
    trend: [],
  };
}

export function sumCostAmounts(records: CostAmountRow[]): number {
  // 数据库存的是分，先求和再转元
  return Money.sum(
    records.map((record) => Money.fromDbCents(record.amount)),
  ).toOutputYuan();
}

export function calculateCostCompareLastPeriod(
  currentTotal: number,
  previousTotal: number,
): number | null {
  return calcPercentChangeWithFallback(currentTotal, previousTotal, {
    precision: 2,
  });
}

export function buildCostRange(
  query: CostQueryInput,
): CostFilterRange | undefined {
  // B4-fix: custom_month / custom_range 缺参数时统一抛 400，不再静默回退全量
  if (query.period === 'custom_month' && query.customDate === undefined) {
    throw new BadRequestException('自定义单日模式需要传 customDate');
  }
  if (query.period === 'custom_range') {
    if (
      query.rangeStartDate === undefined ||
      query.rangeEndDate === undefined
    ) {
      throw new BadRequestException(
        '自定义区间模式需要同时传 rangeStartDate 和 rangeEndDate',
      );
    }
  }
  const range = buildPurchaseDateRange(
    query.period,
    query.customDate,
    query.rangeStartDate,
    query.rangeEndDate,
  );

  // B5-fix: 与报表口径一致，自定义区间起止颠倒时交换，避免返回空结果
  if (
    range &&
    query.period === 'custom_range' &&
    range.gte.getTime() > range.lte.getTime()
  ) {
    return { gte: range.lte, lte: range.gte };
  }

  return range;
}

/**
 * B3-fix: 复用报表的日历对齐「上期」算法（buildPreviousCostReportRange），
 * 保证仪表盘/统计与报表中心的环比口径一致，避免两套实现漂移。
 */
export function buildPreviousCostCalendarRange(
  query: CostQueryInput,
): CostFilterRange | undefined {
  const period = query.period;
  // 全量（all）或为空时没有“上一期”概念
  if (period === undefined || period === 'all') {
    return undefined;
  }

  const current = buildCostRange(query);
  if (!current) {
    return undefined;
  }

  const currentRange: CostReportRange = {
    start: current.gte.getTime(),
    end: current.lte.getTime(),
    period,
  };
  const previous = buildPreviousCostReportRange(period, currentRange);
  return { gte: new Date(previous.start), lte: new Date(previous.end) };
}

export function shouldComparePreviousCostPeriod(
  period: CostQueryInput['period'],
): boolean {
  return (
    period === 'week' ||
    period === 'month' ||
    period === 'quarter' ||
    period === 'year' ||
    period === 'all' ||
    period === 'custom_month' ||
    period === 'custom_range'
  );
}

export function buildCostReportRange(
  query: CostReportQueryInput,
): CostReportRange {
  const period = query.period ?? 'month';
  const now = Date.now();
  const current = new Date(now);

  switch (period) {
    case 'today':
      return {
        start: getDayStart(now),
        end: now,
        period,
      };
    case 'week': {
      return {
        start: getShanghaiWeekStartMs(now),
        end: now,
        period,
      };
    }
    case 'month':
      return {
        start: getShanghaiMonthStartMs(now),
        end: now,
        period,
      };
    case 'quarter': {
      return {
        start: getShanghaiQuarterStartMs(now),
        end: now,
        period,
      };
    }
    case 'year': {
      const currentYear = getShanghaiYear(now);
      const year = query.year ?? currentYear;
      // 非当前年取该年上海时区的 12/31 23:59:59.999，等价于次年元旦零点 -1ms
      const yearEnd =
        year === currentYear ? now : makeShanghaiMs(year + 1, 0, 1) - 1;
      return {
        start: makeShanghaiMs(year, 0, 1),
        end: yearEnd,
        period,
      };
    }
    case 'custom_month': {
      if (query.customDate === undefined) {
        throw new BadRequestException('自定义单日模式需要传 customDate');
      }

      return {
        start: getDayStart(query.customDate),
        end: getDayEnd(query.customDate),
        period,
      };
    }
    case 'custom_range': {
      if (
        query.rangeStartDate === undefined ||
        query.rangeEndDate === undefined
      ) {
        throw new BadRequestException(
          '自定义区间模式需要同时传 rangeStartDate 和 rangeEndDate',
        );
      }

      const start = Math.min(query.rangeStartDate, query.rangeEndDate);
      const end = Math.max(query.rangeStartDate, query.rangeEndDate);
      return {
        start: getDayStart(start),
        end: getDayEnd(end),
        period,
      };
    }
  }
}

export function buildPreviousCostReportRange(
  period: CostReportQueryInput['period'],
  currentRange: CostReportRange,
): CostReportRange {
  const resolvedPeriod = period ?? 'month';

  switch (resolvedPeriod) {
    case 'today':
    case 'custom_month':
      return {
        start: getDayStart(currentRange.start - 24 * 60 * 60 * 1000),
        end: currentRange.start - 1,
        period: resolvedPeriod,
      };
    case 'week':
      return {
        start: currentRange.start - 7 * 24 * 60 * 60 * 1000,
        end: currentRange.start - 1,
        period: resolvedPeriod,
      };
    case 'month': {
      return {
        start: makeShanghaiMs(
          getShanghaiYear(currentRange.start),
          getShanghaiMonth(currentRange.start) - 1,
          1,
        ),
        end: currentRange.start - 1,
        period: resolvedPeriod,
      };
    }
    case 'quarter': {
      return {
        start: makeShanghaiMs(
          getShanghaiYear(currentRange.start),
          getShanghaiMonth(currentRange.start) - 3,
          1,
        ),
        end: currentRange.start - 1,
        period: resolvedPeriod,
      };
    }
    case 'year': {
      // 对称口径：上一年使用与当前年份相同的月/日终点（YTD vs YTD）
      const year = getShanghaiYear(currentRange.start) - 1;
      return {
        start: makeShanghaiMs(year, 0, 1),
        // 取上一年同月同日的上海日末：次日零点 -1ms
        end:
          makeShanghaiMs(
            year,
            getShanghaiMonth(currentRange.end),
            getShanghaiDayOfMonth(currentRange.end) + 1,
          ) - 1,
        period: resolvedPeriod,
      };
    }
    case 'custom_range': {
      const duration = currentRange.end - currentRange.start;
      return {
        start: currentRange.start - duration - 1,
        end: currentRange.start - 1,
        period: resolvedPeriod,
      };
    }
  }
}

export function toPayrollMonth(timestamp: number): string {
  return formatShanghaiYearMonth(timestamp);
}

export function getPayrollCostDate(month: string): Date {
  const [yearText, monthText] = month.split('-');
  const year = Number(yearText);
  const monthValue = Number(monthText);
  // 工资月归属按上海时区的当月 1 号零点入库
  return new Date(makeShanghaiMs(year, monthValue - 1, 1));
}

/**
 * 将前端输入的元金额转为数据库分整数。
 * 仅用于成本写入场景（createRecord、syncPurchaseCost、syncPayrollCosts）。
 */
export function toCostDbCents(yuanValue: number): number {
  return Money.fromInputYuan(yuanValue).toDbCents();
}

function getDayStart(timestamp: number): number {
  return getShanghaiDayStartMs(timestamp);
}

function getDayEnd(timestamp: number): number {
  return getShanghaiDayStartMs(timestamp) + 86_400_000 - 1;
}
