import {
  addMoneyValues,
  getDayStartTimestamp,
  multiplyMoneyValue,
  toDecimalNumber,
  toOptionalMediaText,
  toOptionalText,
} from '../../commerce/commerce.utils';
import type {
  AggregatedRankProduct,
  CostAggregationResult,
  CostRecordRow,
  SaleOrderItemRow,
  SalesAggregationResult,
} from './profit-detail.types';

export function createEmptySalesAggregation(): SalesAggregationResult {
  return {
    revenue: 0,
    orderCount: 0,
    dailyRevenueMap: new Map<number, number>(),
    rankMap: new Map<string, AggregatedRankProduct>(),
  };
}

function shouldPrefixProfitSpaceName(productName: string): boolean {
  return (
    productName === '预付抵扣' ||
    productName === '续费抵扣' ||
    productName.startsWith('台位费（')
  );
}

function resolveProfitProductName(row: SaleOrderItemRow): string {
  const spaceName = toOptionalText(row.order.spaceSession?.space?.name);
  if (!spaceName || !shouldPrefixProfitSpaceName(row.productName)) {
    return row.productName;
  }

  return `${spaceName}${row.productName}`;
}

export function aggregateSales(
  rows: SaleOrderItemRow[],
  start: number,
  end: number,
): SalesAggregationResult {
  let revenue = 0;
  let orderCount = 0;
  const dailyRevenueMap = new Map<number, number>();
  const rankMap = new Map<string, AggregatedRankProduct>();

  for (const row of rows) {
    const timestamp = row.order.date.getTime();
    if (timestamp < start || timestamp > end) {
      continue;
    }

    const price = toDecimalNumber(row.salePrice);
    const profitPerUnit = toDecimalNumber(row.profit);
    const itemRevenue = multiplyMoneyValue(price, row.quantity);
    const itemProfit = multiplyMoneyValue(profitPerUnit, row.quantity);
    revenue = addMoneyValues(revenue, itemRevenue);
    orderCount += row.quantity;

    const dayStart = getDayStartTimestamp(timestamp);
    dailyRevenueMap.set(
      dayStart,
      addMoneyValues(dailyRevenueMap.get(dayStart) ?? 0, itemRevenue),
    );

    mergeRankProduct(
      rankMap,
      row,
      price,
      profitPerUnit,
      itemRevenue,
      itemProfit,
    );
  }

  return {
    revenue,
    orderCount,
    dailyRevenueMap,
    rankMap,
  };
}

export function aggregateCosts(
  rows: CostRecordRow[],
  start: number,
  end: number,
): CostAggregationResult {
  let totalCost = 0;
  const dailyCostMap = new Map<number, number>();
  const categoryCostMap = new Map<CostRecordRow['category'], number>();

  for (const row of rows) {
    const timestamp = row.date.getTime();
    if (timestamp < start || timestamp > end) {
      continue;
    }

    const amount = toDecimalNumber(row.amount);
    totalCost = addMoneyValues(totalCost, amount);

    const dayStart = getDayStartTimestamp(timestamp);
    dailyCostMap.set(
      dayStart,
      addMoneyValues(dailyCostMap.get(dayStart) ?? 0, amount),
    );
    categoryCostMap.set(
      row.category,
      addMoneyValues(categoryCostMap.get(row.category) ?? 0, amount),
    );
  }

  return {
    totalCost,
    dailyCostMap,
    categoryCostMap,
  };
}

function mergeRankProduct(
  rankMap: Map<string, AggregatedRankProduct>,
  row: SaleOrderItemRow,
  price: number,
  profitPerUnit: number,
  itemRevenue: number,
  itemProfit: number,
): void {
  const displayName = resolveProfitProductName(row);
  const rankKey =
    displayName !== row.productName
      ? `space:${displayName}`
      : row.productId !== null
        ? String(row.productId)
        : `snapshot:${displayName}`;
  const currentProduct = rankMap.get(rankKey);

  if (currentProduct) {
    currentProduct.quantity += row.quantity;
    currentProduct.totalProfit = addMoneyValues(
      currentProduct.totalProfit,
      itemProfit,
    );
    currentProduct.totalRevenue = addMoneyValues(
      currentProduct.totalRevenue,
      itemRevenue,
    );
    if (!currentProduct.image && row.image) {
      currentProduct.image = row.image;
    }
    return;
  }

  const image = toOptionalMediaText(row.image);
  rankMap.set(rankKey, {
    id: rankKey,
    name: displayName,
    category: row.categoryName,
    price,
    profitPerUnit,
    quantity: row.quantity,
    totalProfit: itemProfit,
    totalRevenue: itemRevenue,
    ...(image ? { image } : {}),
  });
}
