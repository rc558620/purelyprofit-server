import {
  addMoneyValues,
  getDayStartTimestamp,
  toDecimalNumber,
  toOptionalMediaText,
} from '../../commerce/commerce.utils';
import type {
  AggregatedCategory,
  AggregatedRankProduct,
  BusinessAnalysisCategoryRow,
  BusinessAnalysisCostBucketRow,
  BusinessAnalysisDailyCostRow,
  BusinessAnalysisDailyRevenueRow,
  BusinessAnalysisRankRow,
  CostAggregationResult,
  CostBucketKey,
  SalesAggregationResult,
} from './business-analysis.types';

export function createEmptySalesAggregation(): SalesAggregationResult {
  return {
    revenue: 0,
    orderCount: 0,
    dailyRevenueMap: new Map<number, number>(),
    categoryMap: new Map<string, AggregatedCategory>(),
    rankMap: new Map<string, AggregatedRankProduct>(),
  };
}

export function createEmptyCostAggregation(): CostAggregationResult {
  return {
    totalCost: 0,
    dailyCostMap: new Map<number, number>(),
    costBucketMap: new Map<CostBucketKey, number>(),
  };
}

export function buildSalesAggregation(input: {
  revenue: number;
  orderCount: number;
  dailyRows?: BusinessAnalysisDailyRevenueRow[];
  categoryRows?: BusinessAnalysisCategoryRow[];
  rankRows?: BusinessAnalysisRankRow[];
}): SalesAggregationResult {
  const result = createEmptySalesAggregation();
  result.revenue = input.revenue;
  result.orderCount = input.orderCount;

  for (const row of input.dailyRows ?? []) {
    result.dailyRevenueMap.set(
      getDayStartTimestamp(row.bucketAt.getTime()),
      toDecimalNumber(row.revenue),
    );
  }

  for (const row of input.categoryRows ?? []) {
    result.categoryMap.set(row.categoryName, {
      revenue: toDecimalNumber(row.revenue),
      profit: toDecimalNumber(row.profit),
      quantity: row.quantity,
    });
  }

  for (const row of input.rankRows ?? []) {
    const rankKey =
      row.productId !== null
        ? String(row.productId)
        : `snapshot:${row.productName}`;
    const image = toOptionalMediaText(row.image);
    result.rankMap.set(rankKey, {
      id: rankKey,
      name: row.productName,
      category: row.categoryName,
      totalRevenue: toDecimalNumber(row.totalRevenue),
      totalProfit: toDecimalNumber(row.totalProfit),
      quantity: row.quantity,
      ...(image ? { image } : {}),
    });
  }

  return result;
}

export function buildCostAggregation(input: {
  totalCost: number;
  dailyRows?: BusinessAnalysisDailyCostRow[];
  bucketRows?: BusinessAnalysisCostBucketRow[];
}): CostAggregationResult {
  const result = createEmptyCostAggregation();
  result.totalCost = input.totalCost;

  for (const row of input.dailyRows ?? []) {
    result.dailyCostMap.set(
      getDayStartTimestamp(row.bucketAt.getTime()),
      toDecimalNumber(row.amount),
    );
  }

  for (const row of input.bucketRows ?? []) {
    const bucket = mapCostBucket(row.category);
    result.costBucketMap.set(
      bucket,
      addMoneyValues(
        result.costBucketMap.get(bucket) ?? 0,
        toDecimalNumber(row.amount),
      ),
    );
  }

  return result;
}

const KNOWN_COST_CATEGORIES = new Set([
  'purchase',
  'salary',
  'insurance',
  'provident_fund',
  'rent',
  'utilities',
  'marketing',
  'equipment',
  'packaging',
  'other',
]);

export function mapCostBucket(category: string): CostBucketKey {
  switch (category) {
    case 'purchase':
      return 'purchase';
    case 'salary':
    case 'insurance':
    case 'provident_fund':
      return 'salary';
    case 'rent':
      return 'rent';
    case 'utilities':
      return 'utilities';
    case 'marketing':
      return 'marketing';
    case 'equipment':
    case 'packaging':
    case 'other':
      return 'other';
    default:
      // 未知成本类型静默归入 other，但打印告警日志便于排查新增类型
      if (!KNOWN_COST_CATEGORIES.has(category)) {
        console.warn(
          `[business-analysis] 未知成本类型 "${category}"，已归入「其他」，请确认是否需要新增分类`,
        );
      }
      return 'other';
  }
}
