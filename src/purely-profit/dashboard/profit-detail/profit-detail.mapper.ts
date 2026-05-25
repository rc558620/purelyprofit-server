import {
  calcPercentChange,
  calcPercentOfTotal,
  formatMonthDayLabel,
  getDayStartTimestamp,
  subtractMoneyValues,
} from '../../commerce/commerce.utils';
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

export function buildEmptySummary(): ProfitSummaryDto {
  return {
    revenue: 0,
    totalCost: 0,
    netProfit: 0,
    profitRate: 0,
    compareLastPeriod: null,
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
  netProfit: number,
  orderCount: number,
): ProfitSummaryDto {
  return {
    revenue,
    totalCost,
    netProfit,
    profitRate: calcPercentOfTotal(netProfit, revenue),
    compareLastPeriod: calcPercentChange(revenue, previousRevenue),
    orderCount,
  };
}

export function buildDailyProfits(
  currentRange: ProfitDateRange,
  dailyRevenueMap: Map<number, number>,
  dailyCostMap: Map<number, number>,
): DailyProfitDto[] {
  const days = getChartDays(currentRange);
  const endDayStart = getDayStartTimestamp(currentRange.end);

  return Array.from({ length: days }, (_, index) => {
    const dayStart = endDayStart - (days - 1 - index) * DAY_MS;
    const revenue = dailyRevenueMap.get(dayStart) ?? 0;
    const cost = dailyCostMap.get(dayStart) ?? 0;

    return {
      dateLabel: formatMonthDayLabel(dayStart),
      revenue,
      cost,
      profit: subtractMoneyValues(revenue, cost),
    };
  });
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
      totalRevenue: item.totalRevenue,
      totalProfit: item.totalProfit,
      profitRate: calcPercentOfTotal(item.totalProfit, item.totalRevenue),
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
      price: item.price,
      profitPerUnit: item.profitPerUnit,
      quantity: item.quantity,
      totalProfit: item.totalProfit,
      totalRevenue: item.totalRevenue,
      profitRate: calcPercentOfTotal(item.totalProfit, item.totalRevenue),
      ...(item.image ? { image: item.image } : {}),
    }))
    .sort((left, right) => right.totalProfit - left.totalProfit);
}

export function buildCostBreakdown(
  categoryCostMap: CostAggregationResult['categoryCostMap'],
  totalCost: number,
): CostBreakdownItemDto[] {
  return Array.from(categoryCostMap.entries())
    .map(([category, amount]) => ({
      label: PROFIT_DETAIL_COST_META[category].label,
      amount,
      color: PROFIT_DETAIL_COST_META[category].color,
      percentage: calcPercentOfTotal(amount, totalCost),
    }))
    .sort((left, right) => right.amount - left.amount);
}

export function buildProfitDetailResponse(
  snapshot: ProfitMetricsSnapshot,
): ProfitDetailResponseDto {
  return {
    summary: buildSummary(
      snapshot.currentSales.revenue,
      snapshot.previousSales.revenue,
      snapshot.currentCosts.totalCost,
      snapshot.netProfit,
      snapshot.currentSales.orderCount,
    ),
    dailyProfits: buildDailyProfits(
      snapshot.currentRange,
      snapshot.currentSales.dailyRevenueMap,
      snapshot.currentCosts.dailyCostMap,
    ),
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
  return {
    summary: buildSummary(
      snapshot.currentSales.revenue,
      snapshot.previousSales.revenue,
      snapshot.currentCosts.totalCost,
      snapshot.netProfit,
      snapshot.currentSales.orderCount,
    ),
    products: buildReportProducts(snapshot.currentSales.rankMap),
  };
}

function getChartDays(currentRange: ProfitDateRange): number {
  const diffDays =
    Math.floor(
      (getDayStartTimestamp(currentRange.end)
        - getDayStartTimestamp(currentRange.start)) / DAY_MS,
    ) + 1;

  return Math.max(1, Math.min(diffDays, CHART_DAY_LIMIT));
}
