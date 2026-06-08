import {
  addMoneyValues,
  getDayStartTimestamp,
  multiplyMoneyValue,
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
  CostRecordCostRow,
  CostAggregationResult,
  CostBucketKey,
  SaleOrderItemRow,
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

export function aggregateSales(
  rows: SaleOrderItemRow[],
  start: number,
  end: number,
): SalesAggregationResult {
  let revenue = 0;
  let orderCount = 0;
  const dailyRevenueMap = new Map<number, number>();
  const categoryMap = new Map<string, AggregatedCategory>();
  const rankMap = new Map<string, AggregatedRankProduct>();

  for (const row of rows) {
    const orderTimestamp = row.order.date.getTime();
    if (orderTimestamp < start || orderTimestamp > end) {
      continue;
    }

    const itemRevenue = multiplyMoneyValue(
      toDecimalNumber(row.salePrice),
      row.quantity,
    );
    const itemProfit = multiplyMoneyValue(
      toDecimalNumber(row.profit),
      row.quantity,
    );
    revenue = addMoneyValues(revenue, itemRevenue);
    orderCount += 1;

    const dayStart = getDayStartTimestamp(orderTimestamp);
    dailyRevenueMap.set(
      dayStart,
      addMoneyValues(dailyRevenueMap.get(dayStart) ?? 0, itemRevenue),
    );

    const currentCategory = categoryMap.get(row.categoryName);
    if (currentCategory) {
      currentCategory.revenue = addMoneyValues(
        currentCategory.revenue,
        itemRevenue,
      );
      currentCategory.profit = addMoneyValues(
        currentCategory.profit,
        itemProfit,
      );
      currentCategory.quantity += row.quantity;
    } else {
      categoryMap.set(row.categoryName, {
        revenue: itemRevenue,
        profit: itemProfit,
        quantity: row.quantity,
      });
    }

    const rankKey =
      row.productId !== null
        ? String(row.productId)
        : `snapshot:${row.productName}`;
    const currentProduct = rankMap.get(rankKey);
    if (currentProduct) {
      currentProduct.totalRevenue = addMoneyValues(
        currentProduct.totalRevenue,
        itemRevenue,
      );
      currentProduct.totalProfit = addMoneyValues(
        currentProduct.totalProfit,
        itemProfit,
      );
      currentProduct.quantity += row.quantity;
      if (!currentProduct.image && row.image) {
        currentProduct.image = row.image;
      }
    } else {
      const image = toOptionalMediaText(row.image);
      rankMap.set(rankKey, {
        id: rankKey,
        name: row.productName,
        category: row.categoryName,
        totalRevenue: itemRevenue,
        totalProfit: itemProfit,
        quantity: row.quantity,
        ...(image ? { image } : {}),
      });
    }
  }

  return {
    revenue,
    orderCount,
    dailyRevenueMap,
    categoryMap,
    rankMap,
  };
}

export function aggregateCosts(
  rows: CostRecordCostRow[],
  start: number,
  end: number,
): CostAggregationResult {
  let totalCost = 0;
  const dailyCostMap = new Map<number, number>();
  const costBucketMap = new Map<CostBucketKey, number>();

  for (const row of rows) {
    const timestamp = row.date.getTime();
    if (timestamp < start || timestamp > end) {
      continue;
    }

    const bucket = mapCostBucket(row.category);
    const amount = toDecimalNumber(row.amount);
    totalCost = addMoneyValues(totalCost, amount);

    const dayStart = getDayStartTimestamp(timestamp);
    dailyCostMap.set(
      dayStart,
      addMoneyValues(dailyCostMap.get(dayStart) ?? 0, amount),
    );
    costBucketMap.set(
      bucket,
      addMoneyValues(costBucketMap.get(bucket) ?? 0, amount),
    );
  }

  return {
    totalCost,
    dailyCostMap,
    costBucketMap,
  };
}

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
    default:
      return 'other';
  }
}
