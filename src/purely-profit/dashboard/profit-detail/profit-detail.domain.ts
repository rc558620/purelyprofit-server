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
  SaleOrderItemRow,
  SalesAggregationResult,
} from './profit-detail.types';

export function createEmptySalesAggregation(): SalesAggregationResult {
  return {
    revenue: Money.zero(),
    totalProfit: Money.zero(),
    goodsCost: Money.zero(),
    orderCount: 0,
    dailyRevenueMap: new Map<number, Money>(),
    dailyProfitMap: new Map<number, Money>(),
    dailyGoodsCostMap: new Map<number, Money>(),
    rankMap: new Map<string, AggregatedRankProduct>(),
  };
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

export function aggregateSales(
  rows: SaleOrderItemRow[],
  start: number,
  end: number,
): SalesAggregationResult {
  let revenue = Money.zero();
  let totalProfit = Money.zero();
  let goodsCost = Money.zero();
  let orderCount = 0;
  const dailyRevenueMap = new Map<number, Money>();
  const dailyProfitMap = new Map<number, Money>();
  const dailyGoodsCostMap = new Map<number, Money>();
  const rankMap = new Map<string, AggregatedRankProduct>();

  const seenOrderIds = new Set<number>();

  for (const row of rows) {
    // 排除抵扣行（预付款 + 续费抵扣 + 自助下单抵扣），利润明细只算实际消费。
    // 走 isDeductionItem 而非 isDeductionProductName：前者在 systemProductId 存在时
    // 优先按系统商品 ID 判定，商品被改名也不会漏判。
    // 当前 sale_order_items 表尚无 systemProductId 列，故这里只传 productName（等价回退）；
    // 该列上线后只要在 PROFIT_DETAIL_SALE_ORDER_ITEM_SELECT 里补上 select 即可自动生效。
    if (isDeductionItem({ productName: row.productName })) {
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
    // 商品成本由销售行反推：成交价 − 利润 = 成本价 × 数量（无成本价商品利润=售价，反推为 0）
    const itemGoodsCost = itemRevenue.subtract(itemProfit);
    revenue = revenue.add(itemRevenue);
    totalProfit = totalProfit.add(itemProfit);
    goodsCost = goodsCost.add(itemGoodsCost);
    // orderCount 统计独立订单数（去重），与其他模块口径一致
    seenOrderIds.add(row.order.id);
    orderCount = seenOrderIds.size;

    const dayStart = getShanghaiDayStartMs(timestamp);
    dailyRevenueMap.set(
      dayStart,
      (dailyRevenueMap.get(dayStart) ?? Money.zero()).add(itemRevenue),
    );
    dailyProfitMap.set(
      dayStart,
      (dailyProfitMap.get(dayStart) ?? Money.zero()).add(itemProfit),
    );
    dailyGoodsCostMap.set(
      dayStart,
      (dailyGoodsCostMap.get(dayStart) ?? Money.zero()).add(itemGoodsCost),
    );

    // 券面消费行（「XX（团购券）」）是券面金额的记账载体，不是真实商品。
    // 与经营分析的 EXCLUDE_VOUCHER_ITEM_SQL 同口径（后缀 + 系统分类双条件）：
    // 只踢出商品排行榜，上方金额汇总（营业额/利润/商品成本）与日趋势仍含券面，
    // 门店真实营收一分不少，券的毛利请到营销中心的团购券维度看。
    if (
      isGrouponVoucherItemName(row.productName, row.categoryName ?? undefined)
    ) {
      continue;
    }

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
    totalProfit,
    goodsCost,
    orderCount,
    dailyRevenueMap,
    dailyProfitMap,
    dailyGoodsCostMap,
    rankMap,
  };
}

/**
 * 只累计标量汇总（收入 / 利润 / 商品成本 / 订单数），不构建日维度与商品排行 Map。
 *
 * 上一周期（previous）在下游只用于环比：mapper 只消费 revenue，service 只消费
 * totalProfit（算 previousNetProfit）。此前 previous 复用 aggregateSales，
 * 会为同一批行再建满 dailyRevenueMap / dailyProfitMap / dailyGoodsCostMap /
 * rankMap——等于一半聚合开销在做从未被读取的死计算。这里按实际消费面裁剪，
 * 明细容器一律返回空 Map，结构保持兼容。
 */
export function aggregateSalesTotals(
  rows: SaleOrderItemRow[],
  start: number,
  end: number,
): SalesAggregationResult {
  let revenue = Money.zero();
  let totalProfit = Money.zero();
  let goodsCost = Money.zero();
  const seenOrderIds = new Set<number>();

  for (const row of rows) {
    // 与 aggregateSales 保持同一切除口径：排除抵扣行、排除区间外行
    if (isDeductionItem({ productName: row.productName })) {
      continue;
    }

    const timestamp = row.order.date.getTime();
    if (timestamp < start || timestamp > end) {
      continue;
    }

    const itemRevenue = Money.fromDbCents(row.salePrice).multiply(row.quantity);
    const itemProfit = Money.fromDbCents(row.profit).multiply(row.quantity);
    revenue = revenue.add(itemRevenue);
    totalProfit = totalProfit.add(itemProfit);
    goodsCost = goodsCost.add(itemRevenue.subtract(itemProfit));
    seenOrderIds.add(row.order.id);
  }

  return {
    revenue,
    totalProfit,
    goodsCost,
    orderCount: seenOrderIds.size,
    dailyRevenueMap: new Map<number, Money>(),
    dailyProfitMap: new Map<number, Money>(),
    dailyGoodsCostMap: new Map<number, Money>(),
    rankMap: new Map<string, AggregatedRankProduct>(),
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

/**
 * 同 aggregateSalesTotals：只累计总成本，不建日维度与分类 Map。
 * 上一周期的成本只被消费 totalCost（算 previousNetProfit 与成本环比），
 * dailyCostMap / categoryCostMap 从未被读取。
 */
export function aggregateCostsTotal(
  rows: CostRecordRow[],
  start: number,
  end: number,
): CostAggregationResult {
  let totalCost = Money.zero();

  for (const row of rows) {
    const timestamp = row.date.getTime();
    if (timestamp < start || timestamp > end) {
      continue;
    }

    totalCost = totalCost.add(Money.fromDbCents(row.amount));
  }

  return {
    totalCost,
    dailyCostMap: new Map<number, Money>(),
    categoryCostMap: new Map<CostRecordRow['category'], Money>(),
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
