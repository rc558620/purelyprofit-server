import {
  calcPercentChange,
  calcPercentOfTotal,
} from '../../commerce/commerce.utils';
import { Money } from '../../../shared/money.utils';
import {
  formatShanghaiDayLabel,
  formatYearMonthKeyFromYm,
  getShanghaiDayStartMs,
  getShanghaiFullYear,
  getShanghaiMonthIndex,
} from '../../../shared/shanghai-time.utils';
import type {
  CostBreakdownItemDto,
  DailyProfitDto,
  ProductRankItemDto,
  ProfitDetailResponseDto,
  ProfitReportProductRowDto,
  ProfitReportResponseDto,
  ProfitSummaryDto,
} from './dto/profit-detail-response.dto';
import {
  PROFIT_DETAIL_COST_META,
  type AggregatedRankProduct,
  type CostAggregationResult,
  type ProfitDateRange,
  type ProfitMetricsSnapshot,
} from './profit-detail.types';

const DAY_MS = 86_400_000;
const CHART_DAY_LIMIT = 365;
const PRODUCT_RANKING_LIMIT = 5;

export function buildEmptySummary(): ProfitSummaryDto {
  return {
    revenue: 0,
    totalCost: 0,
    netProfit: 0,
    profitRate: 0,
    revenueCompareLastPeriod: null,
    profitCompareLastPeriod: null,
    costCompareLastPeriod: null,
    orderCount: 0,
  };
}

export function buildEmptyProfitDetailResponse(): ProfitDetailResponseDto {
  return {
    summary: buildEmptySummary(),
    dailyProfits: [],
    productRanking: [],
    costBreakdown: [],
  };
}

export function buildEmptyProfitReportResponse(): ProfitReportResponseDto {
  return {
    summary: buildEmptySummary(),
    products: [],
  };
}

export function buildSummary(
  revenue: number,
  previousRevenue: number,
  totalCost: number,
  previousTotalCost: number,
  netProfit: number,
  previousNetProfit: number,
  orderCount: number,
): ProfitSummaryDto {
  return {
    revenue,
    totalCost,
    netProfit,
    profitRate: calcPercentOfTotal(netProfit, revenue),
    revenueCompareLastPeriod: calcPercentChange(revenue, previousRevenue),
    profitCompareLastPeriod: calcPercentChange(netProfit, previousNetProfit),
    costCompareLastPeriod: calcPercentChange(totalCost, previousTotalCost),
    orderCount,
  };
}

/** 按天粒度产出趋势点，profit 由 Money.subtract() 计算 */
export function buildDailyProfits(
  currentRange: ProfitDateRange,
  dailyRevenueMap: Map<number, Money>,
  dailyCostMap: Map<number, Money>,
): DailyProfitDto[] {
  const days = getChartDays(currentRange);
  const endDayStart = getShanghaiDayStartMs(currentRange.end);

  return Array.from({ length: days }, (_, index) => {
    const dayStart = endDayStart - (days - 1 - index) * DAY_MS;
    const revenueMoney = dailyRevenueMap.get(dayStart) ?? Money.zero();
    const costMoney = dailyCostMap.get(dayStart) ?? Money.zero();
    const profitMoney = revenueMoney.subtract(costMoney);

    return {
      dateLabel: formatShanghaiDayLabel(dayStart),
      revenue: revenueMoney.toOutputYuan(),
      cost: costMoney.toOutputYuan(),
      profit: profitMoney.toOutputYuan(),
    };
  });
}

const MONTH_LABELS = Array.from({ length: 12 }, (_, index) => `${index + 1}月`);

/** 按月粒度产出趋势点，profit 由 Money.subtract() 计算；year 周期专用 */
export function buildMonthlyProfits(
  currentRange: ProfitDateRange,
  dailyRevenueMap: Map<number, Money>,
  dailyCostMap: Map<number, Money>,
): DailyProfitDto[] {
  const monthlyRevenueMap = new Map<number, Money>();
  const monthlyCostMap = new Map<number, Money>();

  for (const [dayStart, revenue] of dailyRevenueMap.entries()) {
    const monthIndex = getShanghaiMonthIndex(dayStart);
    monthlyRevenueMap.set(
      monthIndex,
      (monthlyRevenueMap.get(monthIndex) ?? Money.zero()).add(revenue),
    );
  }

  for (const [dayStart, cost] of dailyCostMap.entries()) {
    const monthIndex = getShanghaiMonthIndex(dayStart);
    monthlyCostMap.set(
      monthIndex,
      (monthlyCostMap.get(monthIndex) ?? Money.zero()).add(cost),
    );
  }

  return MONTH_LABELS.map((label, monthIndex) => {
    const revenueMoney = monthlyRevenueMap.get(monthIndex) ?? Money.zero();
    const costMoney = monthlyCostMap.get(monthIndex) ?? Money.zero();
    const profitMoney = revenueMoney.subtract(costMoney);

    return {
      dateLabel: label,
      revenue: revenueMoney.toOutputYuan(),
      cost: costMoney.toOutputYuan(),
      profit: profitMoney.toOutputYuan(),
    };
  });
}

/**
 * 按“年-月”产出趋势点，覆盖 currentRange 内的完整月份区间。
 *
 * 用于超长 custom_range（跨度 > CHART_DAY_LIMIT 天）的降级展示：
 * 避免 buildDailyProfits 被 365 天上限制截断而丢失早期数据。
 * 与 buildMonthlyProfits（仅单年、标签为“N月”）不同，本函数跨年，
 * 标签带年份（如 2025/12），以区分不同年份的同名月份、避免跨年合并。
 */
export function buildRangeMonthlyProfits(
  currentRange: ProfitDateRange,
  dailyRevenueMap: Map<number, Money>,
  dailyCostMap: Map<number, Money>,
): DailyProfitDto[] {
  const monthlyRevenueMap = new Map<string, Money>();
  const monthlyCostMap = new Map<string, Money>();

  for (const [dayStart, revenue] of dailyRevenueMap.entries()) {
    const key = formatYearMonthKeyFromYm(
      getShanghaiFullYear(dayStart),
      getShanghaiMonthIndex(dayStart),
    );
    monthlyRevenueMap.set(
      key,
      (monthlyRevenueMap.get(key) ?? Money.zero()).add(revenue),
    );
  }

  for (const [dayStart, cost] of dailyCostMap.entries()) {
    const key = formatYearMonthKeyFromYm(
      getShanghaiFullYear(dayStart),
      getShanghaiMonthIndex(dayStart),
    );
    monthlyCostMap.set(
      key,
      (monthlyCostMap.get(key) ?? Money.zero()).add(cost),
    );
  }

  const points: DailyProfitDto[] = [];
  let cursorYear = getShanghaiFullYear(currentRange.start);
  let cursorMonth = getShanghaiMonthIndex(currentRange.start);
  const endYear = getShanghaiFullYear(currentRange.end);
  const endMonth = getShanghaiMonthIndex(currentRange.end);
  while (
    cursorYear < endYear ||
    (cursorYear === endYear && cursorMonth <= endMonth)
  ) {
    const key = formatYearMonthKeyFromYm(cursorYear, cursorMonth);
    const revenueMoney = monthlyRevenueMap.get(key) ?? Money.zero();
    const costMoney = monthlyCostMap.get(key) ?? Money.zero();
    const profitMoney = revenueMoney.subtract(costMoney);

    points.push({
      dateLabel: key,
      revenue: revenueMoney.toOutputYuan(),
      cost: costMoney.toOutputYuan(),
      profit: profitMoney.toOutputYuan(),
    });
    cursorMonth += 1;
    if (cursorMonth > 11) {
      cursorMonth = 0;
      cursorYear += 1;
    }
  }

  return points;
}

export function buildReportProducts(
  rankMap: Map<string, AggregatedRankProduct>,
): ProfitReportProductRowDto[] {
  return Array.from(rankMap.values())
    .map((item) => ({
      id: item.id,
      name: item.name,
      category: item.category,
      quantity: item.quantity,
      totalRevenue: item.totalRevenue.toOutputYuan(),
      totalProfit: item.totalProfit.toOutputYuan(),
      profitRate: calcPercentOfTotal(
        item.totalProfit.toOutputYuan(),
        item.totalRevenue.toOutputYuan(),
      ),
    }))
    .sort((left, right) => right.totalProfit - left.totalProfit);
}

export function buildProductRanking(
  rankMap: Map<string, AggregatedRankProduct>,
): ProductRankItemDto[] {
  return Array.from(rankMap.values())
    .map((item) => ({
      id: item.id,
      name: item.name,
      category: item.category,
      price: item.price.toOutputYuan(),
      profitPerUnit: item.profitPerUnit.toOutputYuan(),
      quantity: item.quantity,
      totalProfit: item.totalProfit.toOutputYuan(),
      totalRevenue: item.totalRevenue.toOutputYuan(),
      profitRate: calcPercentOfTotal(
        item.totalProfit.toOutputYuan(),
        item.totalRevenue.toOutputYuan(),
      ),
      ...(item.image ? { image: item.image } : {}),
    }))
    .sort((left, right) => right.totalProfit - left.totalProfit)
    .slice(0, PRODUCT_RANKING_LIMIT);
}

export function buildCostBreakdown(
  categoryCostMap: CostAggregationResult['categoryCostMap'],
  totalCost: import('../../../shared/money.utils').Money,
): CostBreakdownItemDto[] {
  const totalCostYuan = totalCost.toOutputYuan();
  return Array.from(categoryCostMap.entries())
    .map(([category, amount]) => ({
      label: PROFIT_DETAIL_COST_META[category].label,
      amount: amount.toOutputYuan(),
      color: PROFIT_DETAIL_COST_META[category].color,
      percentage: calcPercentOfTotal(amount.toOutputYuan(), totalCostYuan),
    }))
    .sort((left, right) => right.amount - left.amount);
}

export function buildProfitDetailResponse(
  snapshot: ProfitMetricsSnapshot,
  period?: string,
): ProfitDetailResponseDto {
  const revenueYuan = snapshot.currentSales.revenue.toOutputYuan();
  const previousRevenueYuan = snapshot.previousSales.revenue.toOutputYuan();
  const totalCostYuan = snapshot.currentCosts.totalCost.toOutputYuan();
  const previousTotalCostYuan = snapshot.previousCosts.totalCost.toOutputYuan();
  const netProfitYuan = snapshot.netProfit.toOutputYuan();
  const previousNetProfitYuan = snapshot.previousNetProfit.toOutputYuan();

  const isYearPeriod = period === 'year';
  // 超长区间（> CHART_DAY_LIMIT 天）降级为按月聚合，避免按天被截断丢失数据；
  // 与 year 周期的区别在于按月点带年份标签、覆盖完整所选区间（可跨年）。
  const rangeExceedsDailyCap =
    getRangeDaySpan(snapshot.currentRange) > CHART_DAY_LIMIT;
  const trendProfits = isYearPeriod
    ? buildMonthlyProfits(
        snapshot.currentRange,
        snapshot.currentSales.dailyRevenueMap,
        snapshot.currentCosts.dailyCostMap,
      )
    : rangeExceedsDailyCap
      ? buildRangeMonthlyProfits(
          snapshot.currentRange,
          snapshot.currentSales.dailyRevenueMap,
          snapshot.currentCosts.dailyCostMap,
        )
      : buildDailyProfits(
          snapshot.currentRange,
          snapshot.currentSales.dailyRevenueMap,
          snapshot.currentCosts.dailyCostMap,
        );

  return {
    summary: buildSummary(
      revenueYuan,
      previousRevenueYuan,
      totalCostYuan,
      previousTotalCostYuan,
      netProfitYuan,
      previousNetProfitYuan,
      snapshot.currentSales.orderCount,
    ),
    dailyProfits: trendProfits,
    productRanking: buildProductRanking(snapshot.currentSales.rankMap),
    costBreakdown: buildCostBreakdown(
      snapshot.currentCosts.categoryCostMap,
      snapshot.currentCosts.totalCost,
    ),
  };
}

export function buildProfitReportResponse(
  snapshot: ProfitMetricsSnapshot,
): ProfitReportResponseDto {
  const revenueYuan = snapshot.currentSales.revenue.toOutputYuan();
  const previousRevenueYuan = snapshot.previousSales.revenue.toOutputYuan();
  const totalCostYuan = snapshot.currentCosts.totalCost.toOutputYuan();
  const previousTotalCostYuan = snapshot.previousCosts.totalCost.toOutputYuan();
  const netProfitYuan = snapshot.netProfit.toOutputYuan();
  const previousNetProfitYuan = snapshot.previousNetProfit.toOutputYuan();

  return {
    summary: buildSummary(
      revenueYuan,
      previousRevenueYuan,
      totalCostYuan,
      previousTotalCostYuan,
      netProfitYuan,
      previousNetProfitYuan,
      snapshot.currentSales.orderCount,
    ),
    products: buildReportProducts(snapshot.currentSales.rankMap),
  };
}

function getRangeDaySpan(currentRange: ProfitDateRange): number {
  return (
    Math.floor(
      (getShanghaiDayStartMs(currentRange.end) -
        getShanghaiDayStartMs(currentRange.start)) /
        DAY_MS,
    ) + 1
  );
}

function getChartDays(currentRange: ProfitDateRange): number {
  return Math.max(1, Math.min(getRangeDaySpan(currentRange), CHART_DAY_LIMIT));
}
