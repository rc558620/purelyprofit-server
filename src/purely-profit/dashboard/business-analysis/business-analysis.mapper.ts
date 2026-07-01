import {
  calcPercentChange,
  calcPercentOfTotal,
  calcPercentPointDiff,
  Money,
} from '../../commerce/commerce.utils';
import {
  formatShanghaiDayLabel,
  getShanghaiDayStartMs,
} from './business-analysis.utils';
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
// 经营分析的最长预设周期是今年，趋势图至少要覆盖完整自然年，避免 6 月之后的数据被截断。
const MAX_TREND_DAYS = 366;

export function buildEmptyAnalysisResponse(): BusinessAnalysisResponseDto {
  return {
    heroSummary: {
      netProfit: { current: 0, previous: 0, changeRate: null },
      revenue: { current: 0, previous: 0, changeRate: null },
      totalCost: { current: 0, previous: 0, changeRate: null },
      profitRate: { current: 0, previous: 0, changeRate: 0 },
      costRate: { current: 0, previous: 0, changeRate: 0 },
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
  const currentProfit = snapshot.currentSales.revenue.subtract(
    snapshot.currentCosts.totalCost,
  );
  const previousProfit = snapshot.previousSales.revenue.subtract(
    snapshot.previousCosts.totalCost,
  );
  const currentProfitRate = calcPercentOfTotal(
    currentProfit.toOutputYuan(),
    snapshot.currentSales.revenue.toOutputYuan(),
  );
  const previousProfitRate = calcPercentOfTotal(
    previousProfit.toOutputYuan(),
    snapshot.previousSales.revenue.toOutputYuan(),
  );
  const currentCostRate = calcPercentOfTotal(
    snapshot.currentCosts.totalCost.toOutputYuan(),
    snapshot.currentSales.revenue.toOutputYuan(),
  );
  const previousCostRate = calcPercentOfTotal(
    snapshot.previousCosts.totalCost.toOutputYuan(),
    snapshot.previousSales.revenue.toOutputYuan(),
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
        changeRate: calcPercentPointDiff(currentProfitRate, previousProfitRate),
      },
      costRate: {
        current: currentCostRate,
        previous: previousCostRate,
        changeRate: calcPercentPointDiff(currentCostRate, previousCostRate),
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
  dailyRevenueMap: Map<number, Money>,
  dailyCostMap: Map<number, Money>,
): BusinessAnalysisDailyTrendDto[] {
  const startDay = getShanghaiDayStartMs(start);
  const endDay = getShanghaiDayStartMs(end);
  const days = Math.max(
    1,
    Math.min(MAX_TREND_DAYS, Math.floor((endDay - startDay) / DAY_MS) + 1),
  );
  const items: BusinessAnalysisDailyTrendDto[] = [];

  for (let offset = 0; offset < days; offset += 1) {
    const currentDay = startDay + offset * DAY_MS;
    const revenueMoney = dailyRevenueMap.get(currentDay) ?? Money.zero();
    const costMoney = dailyCostMap.get(currentDay) ?? Money.zero();
    items.push({
      dateLabel: formatShanghaiDayLabel(currentDay),
      revenue: revenueMoney.toOutputYuan(),
      cost: costMoney.toOutputYuan(),
      profit: revenueMoney.subtract(costMoney).toOutputYuan(),
    });
  }

  return items;
}

function buildCategoryShares(
  categoryMap: Map<string, AggregatedCategory>,
  totalRevenue: Money,
): BusinessAnalysisCategoryShareDto[] {
  const totalRevenueYuan = totalRevenue.toOutputYuan();
  return Array.from(categoryMap.entries())
    .map(([name, value]) => ({
      name,
      revenue: value.revenue.toOutputYuan(),
      profit: value.profit.toOutputYuan(),
      profitRate: calcPercentOfTotal(
        value.profit.toOutputYuan(),
        value.revenue.toOutputYuan(),
      ),
      quantity: value.quantity,
      revenueShare: calcPercentOfTotal(
        value.revenue.toOutputYuan(),
        totalRevenueYuan,
      ),
    }))
    .sort((left, right) => right.revenue - left.revenue);
}

function buildCostRateItems(
  bucketMap: Map<CostBucketKey, Money>,
  totalCost: Money,
): BusinessAnalysisCostRateItemDto[] {
  const totalCostYuan = totalCost.toOutputYuan();
  return Array.from(bucketMap.entries())
    .map(([bucket, amount]) => ({
      label: BUSINESS_ANALYSIS_COST_CATEGORY_META[bucket].label,
      amount: amount.toOutputYuan(),
      percentage: calcPercentOfTotal(amount.toOutputYuan(), totalCostYuan),
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
      profitRate: calcPercentOfTotal(
        item.totalProfit.toOutputYuan(),
        item.totalRevenue.toOutputYuan(),
      ),
      totalProfit: item.totalProfit.toOutputYuan(),
      totalRevenue: item.totalRevenue.toOutputYuan(),
      quantity: item.quantity,
      ...(item.image ? { image: item.image } : {}),
    }))
    .sort((left, right) => right.totalProfit - left.totalProfit);
}

function buildCompare(
  current: Money,
  previous: Money,
): BusinessAnalysisCompareDataDto {
  const currentYuan = current.toOutputYuan();
  const previousYuan = previous.toOutputYuan();
  return {
    current: currentYuan,
    previous: previousYuan,
    changeRate: calcPercentChange(currentYuan, previousYuan),
  };
}
