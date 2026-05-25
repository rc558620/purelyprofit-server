import {
  calcPercentChange,
  calcPercentOfTotal,
  formatMonthDayLabel,
  subtractMoneyValues,
} from '../../commerce/commerce.utils';
import type {
  BusinessAnalysisCategoryShareDto,
  BusinessAnalysisCompareDataDto,
  BusinessAnalysisCostRateItemDto,
  BusinessAnalysisDailyTrendDto,
  BusinessAnalysisRankProductDto,
  BusinessAnalysisResponseDto,
} from './dto/business-analysis-response.dto';
import {
  BUSINESS_ANALYSIS_COST_CATEGORY_META,
  type AggregatedCategory,
  type AggregatedRankProduct,
  type BusinessAnalysisMetricsSnapshot,
  type CostBucketKey,
} from './business-analysis.types';

const DAY_MS = 86_400_000;
const MAX_TREND_DAYS = 90;

export function buildEmptyAnalysisResponse(): BusinessAnalysisResponseDto {
  return {
    heroSummary: {
      netProfit: { current: 0, previous: 0, changeRate: null },
      revenue: { current: 0, previous: 0, changeRate: null },
      totalCost: { current: 0, previous: 0, changeRate: null },
      profitRate: { current: 0, previous: 0, changeRate: 0 },
      orderCount: 0,
    },
    dailyTrend: [],
    categoryShares: [],
    costRateItems: [],
    rankProducts: [],
  };
}

export function buildBusinessAnalysisResponse(
  snapshot: BusinessAnalysisMetricsSnapshot,
): BusinessAnalysisResponseDto {
  const currentProfit = subtractMoneyValues(
    snapshot.currentSales.revenue,
    snapshot.currentCosts.totalCost,
  );
  const previousProfit = subtractMoneyValues(
    snapshot.previousSales.revenue,
    snapshot.previousCosts.totalCost,
  );
  const currentProfitRate = calcPercentOfTotal(
    currentProfit,
    snapshot.currentSales.revenue,
  );
  const previousProfitRate = calcPercentOfTotal(
    previousProfit,
    snapshot.previousSales.revenue,
  );

  return {
    heroSummary: {
      netProfit: buildCompare(currentProfit, previousProfit),
      revenue: buildCompare(
        snapshot.currentSales.revenue,
        snapshot.previousSales.revenue,
      ),
      totalCost: buildCompare(
        snapshot.currentCosts.totalCost,
        snapshot.previousCosts.totalCost,
      ),
      profitRate: {
        current: currentProfitRate,
        previous: previousProfitRate,
        changeRate: subtractMoneyValues(currentProfitRate, previousProfitRate),
      },
      orderCount: snapshot.currentSales.orderCount,
    },
    dailyTrend: buildDailyTrend(
      snapshot.currentRange.start,
      snapshot.currentRange.end,
      snapshot.currentSales.dailyRevenueMap,
      snapshot.currentCosts.dailyCostMap,
    ),
    categoryShares: buildCategoryShares(
      snapshot.currentSales.categoryMap,
      snapshot.currentSales.revenue,
    ),
    costRateItems: buildCostRateItems(
      snapshot.currentCosts.costBucketMap,
      snapshot.currentCosts.totalCost,
    ),
    rankProducts: buildRankProducts(snapshot.currentSales.rankMap),
  };
}

function buildDailyTrend(
  start: number,
  end: number,
  dailyRevenueMap: Map<number, number>,
  dailyCostMap: Map<number, number>,
): BusinessAnalysisDailyTrendDto[] {
  const days = Math.max(
    1,
    Math.min(MAX_TREND_DAYS, Math.round((end - start) / DAY_MS) + 1),
  );
  const endDate = new Date(end);
  const items: BusinessAnalysisDailyTrendDto[] = [];

  for (let offset = 0; offset < days; offset += 1) {
    const currentDate = new Date(endDate);
    currentDate.setDate(endDate.getDate() - (days - 1 - offset));
    currentDate.setHours(0, 0, 0, 0);
    const currentDay = currentDate.getTime();
    const revenue = dailyRevenueMap.get(currentDay) ?? 0;
    const cost = dailyCostMap.get(currentDay) ?? 0;
    items.push({
      dateLabel: formatMonthDayLabel(currentDay),
      revenue,
      cost,
      profit: subtractMoneyValues(revenue, cost),
    });
  }

  return items;
}

function buildCategoryShares(
  categoryMap: Map<string, AggregatedCategory>,
  totalRevenue: number,
): BusinessAnalysisCategoryShareDto[] {
  return Array.from(categoryMap.entries())
    .map(([name, value]) => ({
      name,
      revenue: value.revenue,
      profit: value.profit,
      profitRate: calcPercentOfTotal(value.profit, value.revenue),
      quantity: value.quantity,
      revenueShare: calcPercentOfTotal(value.revenue, totalRevenue),
    }))
    .sort((left, right) => right.revenue - left.revenue);
}

function buildCostRateItems(
  bucketMap: Map<CostBucketKey, number>,
  totalCost: number,
): BusinessAnalysisCostRateItemDto[] {
  return Array.from(bucketMap.entries())
    .map(([bucket, amount]) => ({
      label: BUSINESS_ANALYSIS_COST_CATEGORY_META[bucket].label,
      amount,
      percentage: calcPercentOfTotal(amount, totalCost),
      color: BUSINESS_ANALYSIS_COST_CATEGORY_META[bucket].color,
    }))
    .sort((left, right) => right.amount - left.amount);
}

function buildRankProducts(
  rankMap: Map<string, AggregatedRankProduct>,
): BusinessAnalysisRankProductDto[] {
  return Array.from(rankMap.values())
    .map((item) => ({
      id: item.id,
      name: item.name,
      category: item.category,
      profitRate: calcPercentOfTotal(item.totalProfit, item.totalRevenue),
      totalProfit: item.totalProfit,
      totalRevenue: item.totalRevenue,
      quantity: item.quantity,
      ...(item.image ? { image: item.image } : {}),
    }))
    .sort((left, right) => right.totalProfit - left.totalProfit);
}

function buildCompare(
  current: number,
  previous: number,
): BusinessAnalysisCompareDataDto {
  return {
    current,
    previous,
    changeRate: calcPercentChange(current, previous),
  };
}
