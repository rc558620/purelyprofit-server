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

/** 销售聚合的明细容器开关：报表不需要日趋势，详情页才需要 */
export interface SalesAggregationOptions {
  /** 是否收集日趋势（日 / 月折线图） */
  daily?: boolean;
  /** 是否收集商品排行（报表中心需要，上一周期标量不需要） */
  rank?: boolean;
}

/** 成本聚合的明细容器开关：报表只需要总额 */
export interface CostAggregationOptions {
  /** 是否收集日成本（趋势图） */
  daily?: boolean;
  /** 是否收集成本分类（饼图） */
  category?: boolean;
}

/**
 * 明细容器按需返回空 Map：
 * - 上一周期只被消费标量（收入 / 利润 / 商品成本 / 订单数），日趋势与商品排行都不需要；
 * - 报表中心需要商品排行，但不返回日趋势，因此单独关闭 daily 而不是整体关闭。
 */
function buildSalesAggregation(
  acc: SalesAccumulator,
  withDetails: boolean,
  withDaily: boolean,
): SalesAggregationResult {
  return {
    revenue: acc.revenue,
    totalProfit: acc.totalProfit,
    goodsCost: acc.goodsCost,
    orderCount: acc.seenOrderIds.size,
    dailyRevenueMap: withDaily ? acc.dailyRevenueMap : new Map<number, Money>(),
    dailyProfitMap: withDaily ? acc.dailyProfitMap : new Map<number, Money>(),
    dailyGoodsCostMap: withDaily
      ? acc.dailyGoodsCostMap
      : new Map<number, Money>(),
    rankMap: withDetails
      ? acc.rankMap
      : new Map<string, AggregatedRankProduct>(),
  };
}

function buildCostAggregation(
  acc: CostAccumulator,
  withDaily: boolean,
  withCategory: boolean,
): CostAggregationResult {
  return {
    totalCost: acc.totalCost,
    dailyCostMap: withDaily ? acc.dailyCostMap : new Map<number, Money>(),
    categoryCostMap: withCategory
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
  options: SalesAggregationOptions,
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

  const withDaily = options.daily !== false;
  const withRank = options.rank !== false;

  if (withDaily) {
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
  }

  if (!withRank) {
    return;
  }

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
  options: CostAggregationOptions,
): void {
  const amount = Money.fromDbCents(row.amount);
  acc.totalCost = acc.totalCost.add(amount);

  const withDaily = options.daily !== false;
  const withCategory = options.category !== false;

  if (!withDaily && !withCategory) {
    return;
  }

  const dayStart = getShanghaiDayStartMs(timestamp);
  if (withDaily) {
    acc.dailyCostMap.set(
      dayStart,
      (acc.dailyCostMap.get(dayStart) ?? Money.zero()).add(amount),
    );
  }
  if (withCategory) {
    acc.categoryCostMap.set(
      row.category,
      (acc.categoryCostMap.get(row.category) ?? Money.zero()).add(amount),
    );
  }
}

export function createEmptySalesAggregation(): SalesAggregationResult {
  return buildSalesAggregation(createSalesAccumulator(), false, false);
}

/**
 * 单区间聚合。
 *
 * 默认构建全部明细容器；报表中心只消费标量与商品排行，可传 `{ daily: false }`
 * 跳过日趋势，避免为不返回的字段做一次全量遍历与 Map 写入。
 */
export function aggregateSales(
  rows: SaleOrderItemRow[],
  start: number,
  end: number,
  options: SalesAggregationOptions = {},
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
    accumulateSaleRow(acc, row, timestamp, options);
  }
  return buildSalesAggregation(
    acc,
    options.rank !== false,
    options.daily !== false,
  );
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
    accumulateSaleRow(acc, row, timestamp, { daily: false, rank: false });
  }
  return buildSalesAggregation(acc, false, false);
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

/**
 * 单区间成本聚合。
 *
 * 默认构建日趋势与分类结构；报表中心只用总额，可传
 * `{ daily: false, category: false }` 跳过两个容器。
 */
export function aggregateCosts(
  rows: CostRecordRow[],
  start: number,
  end: number,
  options: CostAggregationOptions = {},
): CostAggregationResult {
  const acc = createCostAccumulator();
  const range: ProfitDateRange = { start, end };
  for (const row of rows) {
    const timestamp = row.date.getTime();
    if (!isInRange(timestamp, range)) {
      continue;
    }
    accumulateCostRow(acc, row, timestamp, options);
  }
  return buildCostAggregation(
    acc,
    options.daily !== false,
    options.category !== false,
  );
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
    accumulateCostRow(acc, row, timestamp, { daily: false, category: false });
  }
  return buildCostAggregation(acc, false, false);
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
