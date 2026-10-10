import { makeShanghaiMs } from '../../../shared/shanghai-time.utils';
import {
  buildCostReportRange,
  buildPreviousCostReportRange,
} from './costs.domain';
import type { CostReportRange } from './costs.types';

describe('costs.domain 上期同期区间', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('month 对齐到上月同期', () => {
    const current: CostReportRange = {
      start: makeShanghaiMs(2026, 9, 1),
      end: makeShanghaiMs(2026, 9, 8, 14),
      period: 'month',
    };

    expect(buildPreviousCostReportRange('month', current)).toEqual({
      start: makeShanghaiMs(2026, 8, 1),
      end: makeShanghaiMs(2026, 8, 8, 14),
      period: 'month',
    });
  });

  it('week 对齐到上周同一时刻', () => {
    const current: CostReportRange = {
      start: makeShanghaiMs(2026, 9, 5),
      end: makeShanghaiMs(2026, 9, 8, 14),
      period: 'week',
    };

    expect(buildPreviousCostReportRange('week', current)).toEqual({
      start: makeShanghaiMs(2026, 8, 28),
      end: makeShanghaiMs(2026, 9, 1, 14),
      period: 'week',
    });
  });

  it.each([
    {
      period: 'quarter' as const,
      currentStart: makeShanghaiMs(2026, 9, 1),
      currentEnd: makeShanghaiMs(2026, 9, 8, 14),
      previousStart: makeShanghaiMs(2026, 6, 1),
      previousEnd: makeShanghaiMs(2026, 6, 8, 14),
    },
    {
      period: 'year' as const,
      currentStart: makeShanghaiMs(2026, 0, 1),
      currentEnd: makeShanghaiMs(2026, 9, 8, 14),
      previousStart: makeShanghaiMs(2025, 0, 1),
      previousEnd: makeShanghaiMs(2025, 9, 8, 14),
    },
  ])('$period 对齐到上一周期同一时刻', (sample) => {
    const current: CostReportRange = {
      start: sample.currentStart,
      end: sample.currentEnd,
      period: sample.period,
    };

    expect(buildPreviousCostReportRange(sample.period, current)).toEqual({
      start: sample.previousStart,
      end: sample.previousEnd,
      period: sample.period,
    });
  });

  it('year 查询往年时以上一年全年作为上期', () => {
    jest.spyOn(Date, 'now').mockReturnValue(makeShanghaiMs(2026, 9, 8, 14));
    const current = buildCostReportRange({ period: 'year', year: 2024 });

    expect(buildPreviousCostReportRange('year', current)).toEqual({
      start: makeShanghaiMs(2023, 0, 1),
      end: makeShanghaiMs(2024, 0, 1) - 1,
      period: 'year',
    });
  });

  it('custom_range 结束日为今天时按当前进度生成等长上期', () => {
    const now = makeShanghaiMs(2026, 9, 8, 14);
    jest.spyOn(Date, 'now').mockReturnValue(now);
    const current = buildCostReportRange({
      period: 'custom_range',
      rangeStartDate: makeShanghaiMs(2026, 9, 1),
      rangeEndDate: makeShanghaiMs(2026, 9, 8),
    });
    const previous = buildPreviousCostReportRange('custom_range', current);

    expect(previous.end).toBe(current.start - 1);
    expect(previous.end - previous.start).toBe(now - current.start);
  });

  it('month 在一月时上期起点跨年到去年十二月', () => {
    const current: CostReportRange = {
      start: makeShanghaiMs(2026, 0, 1),
      end: makeShanghaiMs(2026, 0, 8, 14),
      period: 'month',
    };

    expect(buildPreviousCostReportRange('month', current).start).toBe(
      makeShanghaiMs(2025, 11, 1),
    );
  });

  it('month 在三月末时将上期终点钳制到二月末同一时刻', () => {
    const current: CostReportRange = {
      start: makeShanghaiMs(2025, 2, 1),
      end: makeShanghaiMs(2025, 2, 31, 14),
      period: 'month',
    };

    expect(buildPreviousCostReportRange('month', current)).toEqual({
      start: makeShanghaiMs(2025, 1, 1),
      end: makeShanghaiMs(2025, 1, 28, 14),
      period: 'month',
    });
  });

  it('today 对齐到昨天同一时刻', () => {
    const current: CostReportRange = {
      start: makeShanghaiMs(2026, 9, 8),
      end: makeShanghaiMs(2026, 9, 8, 14),
      period: 'today',
    };

    expect(buildPreviousCostReportRange('today', current)).toEqual({
      start: makeShanghaiMs(2026, 9, 7),
      end: makeShanghaiMs(2026, 9, 7, 14),
      period: 'today',
    });
  });

  it('custom_month 使用完整前一天', () => {
    const current: CostReportRange = {
      start: makeShanghaiMs(2026, 9, 8),
      end: makeShanghaiMs(2026, 9, 9) - 1,
      period: 'custom_month',
    };

    expect(buildPreviousCostReportRange('custom_month', current)).toEqual({
      start: makeShanghaiMs(2026, 9, 7),
      end: makeShanghaiMs(2026, 9, 8) - 1,
      period: 'custom_month',
    });
  });
});
