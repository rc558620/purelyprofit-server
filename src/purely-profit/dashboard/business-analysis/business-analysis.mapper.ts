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
// 与 service 层 clampRangeToMaxTrendDays 的 MAX_TREND_DAYS 保持同一取值（366 天），
// 作为 mapper 层的防御性兜底：service 已先裁剪区间到 366 天内，此处再 cap 一次，
// 即使未来 service 裁剪逻辑变动，也能保护日趋势数组规模不会失控。
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
  // 净利润 = 商品利润总和（售价 − 成本价，销售行快照） − 费用记录（成本管理），
  // 修复此前仅用「收入 − 费用记录」导致商品成本未被扣除、利润虚高的问题
  const currentProfit = snapshot.currentSales.totalProfit.subtract(
    snapshot.currentCosts.totalCost,
  );
  const previousProfit = snapshot.previousSales.totalProfit.subtract(
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
  // 总成本仅统计费用记录（成本管理），商品成本已内含于销售行利润快照
  const currentTotalCost = snapshot.currentCosts.totalCost;
  const previousTotalCost = snapshot.previousCosts.totalCost;
  const currentCostRate = calcPercentOfTotal(
    currentTotalCost.toOutputYuan(),
    snapshot.currentSales.revenue.toOutputYuan(),
  );
  const previousCostRate = calcPercentOfTotal(
    previousTotalCost.toOutputYuan(),
    snapshot.previousSales.revenue.toOutputYuan(),
  );

  return {
    heroSummary: {
      netProfit: buildCompare(currentProfit, previousProfit),
      revenue: buildCompare(
        snapshot.currentSales.revenue,
        snapshot.previousSales.revenue,
      ),
      totalCost: buildCompare(currentTotalCost, previousTotalCost),
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
      snapshot.currentSales.dailyProfitMap,
      snapshot.currentCosts.dailyCostMap,
    ),
    categoryShares: buildCategoryShares(
      snapshot.currentSales.categoryMap,
      snapshot.currentSales.revenue,
    ),
    costRateItems: buildCostRateItems(
      snapshot.currentCosts.costBucketMap,
      currentTotalCost,
    ),
    rankProducts: buildRankProducts(snapshot.currentSales.rankMap),
  };
}

function buildDailyTrend(
  start: number,
  end: number,
  dailyRevenueMap: Map<number, Money>,
  dailyProfitMap: Map<number, Money>,
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
    // 净利润 = 当日商品利润快照 − 当日费用记录
    const profitMoney = (
      dailyProfitMap.get(currentDay) ?? Money.zero()
    ).subtract(costMoney);
    items.push({
      dateLabel: formatShanghaiDayLabel(currentDay),
      revenue: revenueMoney.toOutputYuan(),
      cost: costMoney.toOutputYuan(),
      profit: profitMoney.toOutputYuan(),
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
