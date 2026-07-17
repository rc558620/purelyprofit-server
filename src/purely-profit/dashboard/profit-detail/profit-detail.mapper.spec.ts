import { Money } from '../../../shared/money.utils';
import {
  buildProductRanking,
  buildProfitDetailResponse,
  buildRangeMonthlyProfits,
} from './profit-detail.mapper';
import { createEmptySalesAggregation } from './profit-detail.domain';
import type {
  AggregatedRankProduct,
  ProfitDateRange,
  ProfitMetricsSnapshot,
} from './profit-detail.types';

function dayStart(year: number, month: number, day: number): number {
  return new Date(year, month - 1, day, 0, 0, 0, 0).getTime();
}

function buildSnapshot(
  start: number,
  end: number,
  dailyRevenueMap: Map<number, Money>,
): ProfitMetricsSnapshot {
  return {
    currentRange: { start, end, clamped: false, empty: false },
    currentSales: {
      revenue: Money.zero(),
      orderCount: 0,
      dailyRevenueMap,
      rankMap: new Map(),
    },
    previousSales: createEmptySalesAggregation(),
    currentCosts: {
      totalCost: Money.zero(),
      dailyCostMap: new Map(),
      categoryCostMap: new Map(),
    },
    previousCosts: {
      totalCost: Money.zero(),
      dailyCostMap: new Map(),
      categoryCostMap: new Map(),
    },
    netProfit: Money.zero(),
    previousNetProfit: Money.zero(),
  };
}

describe('profit-detail.mapper 趋势粒度（P2-2）', () => {
  it('buildRangeMonthlyProfits 跨年不合并同名月份，且覆盖完整区间', () => {
    const revenueMap = new Map<number, Money>([
      [dayStart(2025, 12, 15), Money.fromInputYuan(100)],
      [dayStart(2026, 1, 10), Money.fromInputYuan(200)],
      [dayStart(2026, 6, 20), Money.fromInputYuan(50)],
    ]);
    const costMap = new Map<number, Money>([
      [dayStart(2025, 12, 15), Money.fromInputYuan(40)],
      [dayStart(2026, 1, 10), Money.fromInputYuan(60)],
      [dayStart(2026, 6, 20), Money.fromInputYuan(10)],
    ]);

    const points = buildRangeMonthlyProfits(
      { start: dayStart(2025, 12, 1), end: dayStart(2026, 6, 30) },
      revenueMap,
      costMap,
    );

    // 2025/12 ~ 2026/06 共 7 个月点
    expect(points).toHaveLength(7);
    expect(points[0].dateLabel).toBe('2025/12');
    expect(points[6].dateLabel).toBe('2026/06');
    // 同名月份不跨年合并：此处 2025/12 独立存在
    const dec2025 = points.find((point) => point.dateLabel === '2025/12');
    expect(dec2025?.revenue).toBe(100);
    expect(dec2025?.cost).toBe(40);
  });

  it('buildProfitDetailResponse 对超长 custom_range 降级为按月（带年份），不截断到 365 天', () => {
    const start = dayStart(2025, 1, 1);
    const end = dayStart(2026, 12, 31);
    const revenueMap = new Map<number, Money>([
      [dayStart(2025, 1, 15), Money.fromInputYuan(10)],
      [dayStart(2026, 12, 15), Money.fromInputYuan(20)],
    ]);

    const result = buildProfitDetailResponse(
      buildSnapshot(start, end, revenueMap),
      'custom_range',
    );

    // 2025/01 ~ 2026/12 共 24 个月点，未被 365 天上限截断
    expect(result.dailyProfits).toHaveLength(24);
    expect(result.dailyProfits[0].dateLabel).toBe('2025/01');
    expect(result.dailyProfits[23].dateLabel).toBe('2026/12');
  });

  it('buildProfitDetailResponse 对 1 年内的 custom_range 仍按天展示', () => {
    const start = dayStart(2026, 5, 1);
    const end = dayStart(2026, 5, 26);
    const revenueMap = new Map<number, Money>([
      [dayStart(2026, 5, 1), Money.fromInputYuan(1)],
    ]);

    const result = buildProfitDetailResponse(
      buildSnapshot(start, end, revenueMap),
      'custom_range',
    );

    expect(result.dailyProfits).toHaveLength(26);
    expect(result.dailyProfits[0].dateLabel).toBe('05/01');
  });
});

describe('profit-detail.mapper 商品利润排行上限', () => {
  it('buildProductRanking 仅返回利润最高的前 5 条', () => {
    const rankMap = new Map<string, AggregatedRankProduct>();
    // 8 条商品，totalProfit 从高到低：p8(800) ... p1(100)
    for (let i = 1; i <= 8; i++) {
      rankMap.set(`p${i}`, {
        id: `p${i}`,
        name: `商品${i}`,
        category: 'c',
        price: Money.fromInputYuan(1),
        profitPerUnit: Money.fromInputYuan(1),
        quantity: 1,
        totalProfit: Money.fromDbCents(i * 100),
        totalRevenue: Money.fromDbCents(i * 100),
      });
    }

    const ranking = buildProductRanking(rankMap);

    expect(ranking).toHaveLength(5);
    // 利润最高在前：前 5 为 p8(800) ~ p4(400)，p1~p3 被截断
    expect(ranking[0].id).toBe('p8');
    expect(ranking[4].id).toBe('p4');
    expect(ranking.map((item) => item.id)).not.toContain('p1');
    expect(ranking.map((item) => item.id)).not.toContain('p2');
    expect(ranking.map((item) => item.id)).not.toContain('p3');
  });
});
