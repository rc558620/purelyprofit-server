import {
  isDeductionItem,
  isGrouponVoucherItemName,
  toOptionalMediaText,
  toOptionalText,
} from '../../commerce/commerce.utils';
import { getShanghaiDayStartMs } from '../../../shared/shanghai-time.utils';
import { Money } from '../../../shared/money.utils';
import type {
  AggregatedRankProduct,
  CostAggregationResult,
  CostRecordRow,
  ProfitDateRange,
  ProfitPreviousTotals,
  SaleOrderItemRow,
  SalesAggregationResult,
} from './profit-detail.types';

interface SalesAccumulator {
  revenue: Money;
  totalProfit: Money;
  goodsCost: Money;
  seenOrderIds: Set<number>;
  dailyRevenueMap: Map<number, Money>;
  dailyProfitMap: Map<number, Money>;
  dailyGoodsCostMap: Map<number, Money>;
  rankMap: Map<string, AggregatedRankProduct>;
}

interface CostAccumulator {
  totalCost: Money;
  dailyCostMap: Map<number, Money>;
  categoryCostMap: Map<CostRecordRow['category'], Money>;
}

export interface ProfitPreviousAggregations {
  sales: SalesAggregationResult;
  costs: CostAggregationResult;
}

function createSalesAccumulator(): SalesAccumulator {
  return {
    revenue: Money.zero(),
    totalProfit: Money.zero(),
    goodsCost: Money.zero(),
    seenOrderIds: new Set<number>(),
    dailyRevenueMap: new Map<number, Money>(),
    dailyProfitMap: new Map<number, Money>(),
    dailyGoodsCostMap: new Map<number, Money>(),
    rankMap: new Map<string, AggregatedRankProduct>(),
  };
}

function createCostAccumulator(): CostAccumulator {
  return {
    totalCost: Money.zero(),
    dailyCostMap: new Map<number, Money>(),
    categoryCostMap: new Map<CostRecordRow['category'], Money>(),
  };
}

/**
 * withDetails=false 时明细容器一律返回空 Map：上一周期只被消费标量
 * （收入 / 利润 / 商品成本 / 订单数），日趋势与商品排行下游从未读取。
 */
function buildSalesAggregation(
  acc: SalesAccumulator,
  withDetails: boolean,
): SalesAggregationResult {
  return {
    revenue: acc.revenue,
    totalProfit: acc.totalProfit,
    goodsCost: acc.goodsCost,
    orderCount: acc.seenOrderIds.size,
    dailyRevenueMap: withDetails
      ? acc.dailyRevenueMap
      : new Map<number, Money>(),
    dailyProfitMap: withDetails ? acc.dailyProfitMap : new Map<number, Money>(),
    dailyGoodsCostMap: withDetails
      ? acc.dailyGoodsCostMap
      : new Map<number, Money>(),
    rankMap: withDetails
      ? acc.rankMap
      : new Map<string, AggregatedRankProduct>(),
  };
}

function buildCostAggregation(
  acc: CostAccumulator,
  withDetails: boolean,
): CostAggregationResult {
  return {
    totalCost: acc.totalCost,
    dailyCostMap: withDetails ? acc.dailyCostMap : new Map<number, Money>(),
    categoryCostMap: withDetails
      ? acc.categoryCostMap
      : new Map<CostRecordRow['category'], Money>(),
  };
}

function isEligibleSaleRow(row: SaleOrderItemRow): boolean {
  // 排除抵扣行（预付款 + 续费抵扣 + 自助下单抵扣），利润明细只算实际消费。
  // 走 isDeductionItem 而非 isDeductionProductName：前者在 systemProductId 存在时
  // 优先按系统商品 ID 判定，商品被改名也不会漏判。
  // 当前 sale_order_items 表尚无 systemProductId 列，故这里只传 productName（等价回退）；
  // 该列上线后只要在 PROFIT_DETAIL_SALE_ORDER_ITEM_SELECT 里补上 select 即可自动生效。
  return !isDeductionItem({ productName: row.productName });
}

function isInRange(timestamp: number, range: ProfitDateRange): boolean {
  return timestamp >= range.start && timestamp <= range.end;
}

function accumulateSaleRow(
  acc: SalesAccumulator,
  row: SaleOrderItemRow,
  timestamp: number,
  withDetails: boolean,
): void {
  const price = Money.fromDbCents(row.salePrice);
  const profitPerUnit = Money.fromDbCents(row.profit);
  const itemRevenue = price.multiply(row.quantity);
  const itemProfit = profitPerUnit.multiply(row.quantity);
  // 商品成本由销售行反推：成交价 − 利润 = 成本价 × 数量（无成本价商品利润=售价，反推为 0）
  const itemGoodsCost = itemRevenue.subtract(itemProfit);
  acc.revenue = acc.revenue.add(itemRevenue);
  acc.totalProfit = acc.totalProfit.add(itemProfit);
  acc.goodsCost = acc.goodsCost.add(itemGoodsCost);
  // orderCount 统计独立订单数（去重），与其他模块口径一致
  acc.seenOrderIds.add(row.order.id);

  if (!withDetails) {
    return;
  }

  const dayStart = getShanghaiDayStartMs(timestamp);
  acc.dailyRevenueMap.set(
    dayStart,
    (acc.dailyRevenueMap.get(dayStart) ?? Money.zero()).add(itemRevenue),
  );
  acc.dailyProfitMap.set(
    dayStart,
    (acc.dailyProfitMap.get(dayStart) ?? Money.zero()).add(itemProfit),
  );
  acc.dailyGoodsCostMap.set(
    dayStart,
    (acc.dailyGoodsCostMap.get(dayStart) ?? Money.zero()).add(itemGoodsCost),
  );

  // 券面消费行（「XX（团购券）」）是券面金额的记账载体，不是真实商品。
  // 与经营分析的 EXCLUDE_VOUCHER_ITEM_SQL 同口径（后缀 + 系统分类双条件）：
  // 只踢出商品排行榜，上方金额汇总（营业额/利润/商品成本）与日趋势仍含券面，
  // 门店真实营收一分不少，券的毛利请到营销中心的团购券维度看。
  if (
    isGrouponVoucherItemName(row.productName, row.categoryName ?? undefined)
  ) {
    return;
  }

  mergeRankProduct(
    acc.rankMap,
    row,
    price,
    profitPerUnit,
    itemRevenue,
    itemProfit,
  );
}

function accumulateCostRow(
  acc: CostAccumulator,
  row: CostRecordRow,
  timestamp: number,
  withDetails: boolean,
): void {
  const amount = Money.fromDbCents(row.amount);
  acc.totalCost = acc.totalCost.add(amount);

  if (!withDetails) {
    return;
  }

  const dayStart = getShanghaiDayStartMs(timestamp);
  acc.dailyCostMap.set(
    dayStart,
    (acc.dailyCostMap.get(dayStart) ?? Money.zero()).add(amount),
  );
  acc.categoryCostMap.set(
    row.category,
    (acc.categoryCostMap.get(row.category) ?? Money.zero()).add(amount),
  );
}

export function createEmptySalesAggregation(): SalesAggregationResult {
  return buildSalesAggregation(createSalesAccumulator(), false);
}

/** 单区间完整聚合：日趋势与商品排行需要完整明细容器。 */
export function aggregateSales(
  rows: SaleOrderItemRow[],
  start: number,
  end: number,
): SalesAggregationResult {
  const acc = createSalesAccumulator();
  const range: ProfitDateRange = { start, end };
  for (const row of rows) {
    if (!isEligibleSaleRow(row)) {
      continue;
    }
    const timestamp = row.order.date.getTime();
    if (!isInRange(timestamp, range)) {
      continue;
    }
    accumulateSaleRow(acc, row, timestamp, true);
  }
  return buildSalesAggregation(acc, true);
}

/** 单区间标量聚合；上一周期已下推 SQL，此函数保留为口径对账基准。 */
export function aggregateSalesTotals(
  rows: SaleOrderItemRow[],
  start: number,
  end: number,
): SalesAggregationResult {
  const acc = createSalesAccumulator();
  const range: ProfitDateRange = { start, end };
  for (const row of rows) {
    if (!isEligibleSaleRow(row)) {
      continue;
    }
    const timestamp = row.order.date.getTime();
    if (!isInRange(timestamp, range)) {
      continue;
    }
    accumulateSaleRow(acc, row, timestamp, false);
  }
  return buildSalesAggregation(acc, false);
}

/**
 * 由 SQL 下推的上一周期标量还原聚合结果。
 *
 * 上一周期只被消费 revenue / totalProfit / totalCost（环比与净利润），
 * 日维度、商品排行、成本分类容器一律返回空 Map，与原先
 * aggregateSalesTotals / aggregateCostsTotal 的返回形状严格一致。
 */
export function buildPreviousAggregations(
  totals: ProfitPreviousTotals,
): ProfitPreviousAggregations {
  return {
    sales: {
      revenue: Money.fromDbCents(totals.revenueCents),
      totalProfit: Money.fromDbCents(totals.profitCents),
      goodsCost: Money.fromDbCents(totals.goodsCostCents),
      orderCount: totals.orderCount,
      dailyRevenueMap: new Map<number, Money>(),
      dailyProfitMap: new Map<number, Money>(),
      dailyGoodsCostMap: new Map<number, Money>(),
      rankMap: new Map<string, AggregatedRankProduct>(),
    },
    costs: {
      totalCost: Money.fromDbCents(totals.totalCostCents),
      dailyCostMap: new Map<number, Money>(),
      categoryCostMap: new Map<CostRecordRow['category'], Money>(),
    },
  };
}

/** 单区间完整成本聚合。 */
export function aggregateCosts(
  rows: CostRecordRow[],
  start: number,
  end: number,
): CostAggregationResult {
  const acc = createCostAccumulator();
  const range: ProfitDateRange = { start, end };
  for (const row of rows) {
    const timestamp = row.date.getTime();
    if (!isInRange(timestamp, range)) {
      continue;
    }
    accumulateCostRow(acc, row, timestamp, true);
  }
  return buildCostAggregation(acc, true);
}

/** 单区间成本标量聚合；上一周期已下推 SQL，此函数保留为口径对账基准。 */
export function aggregateCostsTotal(
  rows: CostRecordRow[],
  start: number,
  end: number,
): CostAggregationResult {
  const acc = createCostAccumulator();
  const range: ProfitDateRange = { start, end };
  for (const row of rows) {
    const timestamp = row.date.getTime();
    if (!isInRange(timestamp, range)) {
      continue;
    }
    accumulateCostRow(acc, row, timestamp, false);
  }
  return buildCostAggregation(acc, false);
}

/**
 * 台位费行命名：兼容「台位费（固定）/ 台位费（按单价）」与
 * 「台位费 2小时30分钟」（计时模式已去掉括号）两种形式。
 */
const TABLE_FEE_NAME_RE = /^台位费(（|\s|$)/;

function shouldPrefixProfitSpaceName(productName: string): boolean {
  return TABLE_FEE_NAME_RE.test(productName);
}

function resolveProfitProductName(row: SaleOrderItemRow): string {
  const spaceName = toOptionalText(row.order.spaceSession?.space?.name);
  if (!spaceName || !shouldPrefixProfitSpaceName(row.productName)) {
    return row.productName;
  }

  return `${spaceName}${row.productName}`;
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
