import { Logger } from '@nestjs/common';
import {
  getDayStartTimestamp,
  toOptionalMediaText,
} from '../../commerce/commerce.utils';
import { Money, type MoneyDbCentsInput } from '../../../shared/money.utils';
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

const logger = new Logger('BusinessAnalysisDomain');

/**
 * 安全地将数据库分值转为 Money，null/undefined 视为 0。
 */
function safeDbCents(value: MoneyDbCentsInput | null | undefined): Money {
  if (value === null || value === undefined) {
    return Money.zero();
  }
  return Money.fromDbCents(value);
}

export function createEmptySalesAggregation(): SalesAggregationResult {
  return {
    revenue: Money.zero(),
    orderCount: 0,
    dailyRevenueMap: new Map<number, Money>(),
    categoryMap: new Map<string, AggregatedCategory>(),
    rankMap: new Map<string, AggregatedRankProduct>(),
  };
}

export function createEmptyCostAggregation(): CostAggregationResult {
  return {
    totalCost: Money.zero(),
    dailyCostMap: new Map<number, Money>(),
    costBucketMap: new Map<CostBucketKey, Money>(),
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
  result.revenue = Money.fromDbCents(input.revenue);
  result.orderCount = input.orderCount;

  for (const row of input.dailyRows ?? []) {
    result.dailyRevenueMap.set(
      getDayStartTimestamp(row.bucketAt.getTime()),
      safeDbCents(row.revenue),
    );
  }

  for (const row of input.categoryRows ?? []) {
    result.categoryMap.set(row.categoryName, {
      revenue: safeDbCents(row.revenue),
      profit: safeDbCents(row.profit),
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
      totalRevenue: safeDbCents(row.totalRevenue),
      totalProfit: safeDbCents(row.totalProfit),
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
  result.totalCost = Money.fromDbCents(input.totalCost);

  for (const row of input.dailyRows ?? []) {
    result.dailyCostMap.set(
      getDayStartTimestamp(row.bucketAt.getTime()),
      safeDbCents(row.amount),
    );
  }

  for (const row of input.bucketRows ?? []) {
    const bucket = mapCostBucket(row.category);
    result.costBucketMap.set(
      bucket,
      (result.costBucketMap.get(bucket) ?? Money.zero()).add(
        safeDbCents(row.amount),
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
        logger.warn(
          `[business-analysis] 未知成本类型 "${category}"，已归入「其他」，请确认是否需要新增分类`,
        );
      }
      return 'other';
  }
}
