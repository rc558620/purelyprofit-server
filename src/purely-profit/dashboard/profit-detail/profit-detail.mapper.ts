import {
  calcPercentChange,
  calcPercentOfTotal,
  formatMonthDayLabel,
  getDayStartTimestamp,
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

export function buildDailyProfits(
  currentRange: ProfitDateRange,
  dailyRevenueMap: Map<number, import('../../../shared/money.utils').Money>,
  dailyCostMap: Map<number, import('../../../shared/money.utils').Money>,
): DailyProfitDto[] {
  const days = getChartDays(currentRange);
  const endDayStart = getDayStartTimestamp(currentRange.end);

  return Array.from({ length: days }, (_, index) => {
    const dayStart = endDayStart - (days - 1 - index) * DAY_MS;
    const revenue = dailyRevenueMap.get(dayStart)?.toOutputYuan() ?? 0;
    const cost = dailyCostMap.get(dayStart)?.toOutputYuan() ?? 0;

    return {
      dateLabel: formatMonthDayLabel(dayStart),
      revenue,
      cost,
      profit: revenue - cost,
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
    .sort((left, right) => right.totalProfit - left.totalProfit);
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
): ProfitDetailResponseDto {
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

function getChartDays(currentRange: ProfitDateRange): number {
  const diffDays =
    Math.floor(
      (getDayStartTimestamp(currentRange.end) -
        getDayStartTimestamp(currentRange.start)) /
        DAY_MS,
    ) + 1;

  return Math.max(1, Math.min(diffDays, CHART_DAY_LIMIT));
}
