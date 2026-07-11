import {
  isDeductionProductName,
  toOptionalMediaText,
  toOptionalText,
} from '../../commerce/commerce.utils';
import { getShanghaiDayStartMs } from '../../../shared/shanghai-time.utils';
import { Money } from '../../../shared/money.utils';
import type {
  AggregatedRankProduct,
  CostAggregationResult,
  CostRecordRow,
  SaleOrderItemRow,
  SalesAggregationResult,
} from './profit-detail.types';

export function createEmptySalesAggregation(): SalesAggregationResult {
  return {
    revenue: Money.zero(),
    orderCount: 0,
    dailyRevenueMap: new Map<number, Money>(),
    rankMap: new Map<string, AggregatedRankProduct>(),
  };
}

function shouldPrefixProfitSpaceName(productName: string): boolean {
  return productName.startsWith('台位费（');
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
  let revenue = Money.zero();
  let orderCount = 0;
  const dailyRevenueMap = new Map<number, Money>();
  const rankMap = new Map<string, AggregatedRankProduct>();

  const seenOrderIds = new Set<number>();

  for (const row of rows) {
    // 排除抵扣行（预付款 + 续费抵扣），利润明细只算实际消费
    if (isDeductionProductName(row.productName)) {
      continue;
    }

    const timestamp = row.order.date.getTime();
    if (timestamp < start || timestamp > end) {
      continue;
    }

    const price = Money.fromDbCents(row.salePrice);
    const profitPerUnit = Money.fromDbCents(row.profit);
    const itemRevenue = price.multiply(row.quantity);
    const itemProfit = profitPerUnit.multiply(row.quantity);
    revenue = revenue.add(itemRevenue);
    // orderCount 统计独立订单数（去重），与其他模块口径一致
    seenOrderIds.add(row.order.id);
    orderCount = seenOrderIds.size;

    const dayStart = getShanghaiDayStartMs(timestamp);
    dailyRevenueMap.set(
      dayStart,
      (dailyRevenueMap.get(dayStart) ?? Money.zero()).add(itemRevenue),
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
  let totalCost = Money.zero();
  const dailyCostMap = new Map<number, Money>();
  const categoryCostMap = new Map<CostRecordRow['category'], Money>();

  for (const row of rows) {
    const timestamp = row.date.getTime();
    if (timestamp < start || timestamp > end) {
      continue;
    }

    const amount = Money.fromDbCents(row.amount);
    totalCost = totalCost.add(amount);

    const dayStart = getShanghaiDayStartMs(timestamp);
    dailyCostMap.set(
      dayStart,
      (dailyCostMap.get(dayStart) ?? Money.zero()).add(amount),
    );
    categoryCostMap.set(
      row.category,
      (categoryCostMap.get(row.category) ?? Money.zero()).add(amount),
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
  price: Money,
  profitPerUnit: Money,
  itemRevenue: Money,
  itemProfit: Money,
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
    currentProduct.totalProfit = currentProduct.totalProfit.add(itemProfit);
    currentProduct.totalRevenue = currentProduct.totalRevenue.add(itemRevenue);
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
