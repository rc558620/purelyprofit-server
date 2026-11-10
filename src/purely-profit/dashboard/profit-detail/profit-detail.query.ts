import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';
import {
  PROFIT_DETAIL_COST_RECORD_SELECT,
  PROFIT_DETAIL_SALE_ORDER_ITEM_SELECT,
  type CostRecordRow,
  type ProfitAccessibleRange,
  type ProfitDateRange,
  type ProfitPreviousTotals,
  type SaleOrderItemRow,
} from './profit-detail.types';

/**
 * 游标翻页单页行数。窗口内数据最终仍全量载入内存聚合，页大小只决定往返次数：
 * 从 5000 提到 10000 可让大店 / 年维度的 DB 往返减半，且不改变行序与聚合口径。
 * 不再放大是为了避免单页查询逼近 statement_timeout（默认 10s）与单次结果集过大。
 */
export const PROFIT_DETAIL_PAGE_SIZE = 10_000;

export interface ProfitRowsSnapshot {
  saleRows: SaleOrderItemRow[];
  costRows: CostRecordRow[];
  previousTotals: ProfitPreviousTotals;
}

interface ProfitPreviousTotalsRow {
  revenue: Prisma.Decimal | null;
  profit: Prisma.Decimal | null;
  goods_cost: Prisma.Decimal | null;
  order_count: bigint;
  total_cost: Prisma.Decimal | null;
}

const EMPTY_PROFIT_PREVIOUS_TOTALS: ProfitPreviousTotals = {
  revenueCents: 0,
  profitCents: 0,
  goodsCostCents: 0,
  orderCount: 0,
  totalCostCents: 0,
};

export function buildSaleOrderItemQuery(
  storeId: number,
  range: ProfitDateRange,
): Pick<Prisma.SaleOrderItemFindManyArgs, 'where' | 'orderBy'> {
  return {
    where: {
      storeId,
      order: {
        date: {
          gte: new Date(range.start),
          lte: new Date(range.end),
        },
      },
    },
    orderBy: [{ order: { date: 'asc' } }, { id: 'asc' }],
  };
}

export function buildCostRecordQuery(
  storeId: number,
  range: ProfitDateRange,
): Pick<Prisma.CostRecordFindManyArgs, 'where' | 'orderBy'> {
  return {
    where: {
      storeId,
      date: {
        gte: new Date(range.start),
        lte: new Date(range.end),
      },
    },
    orderBy: [{ date: 'asc' }, { id: 'asc' }],
  };
}

/**
 * 上一周期只用于环比，仅需要 5 个标量，因此不再把上一周期明细拉进内存。
 *
 * SQL 口径与 JS 聚合严格对齐：
 * - 抵扣行排除列表与 isDeductionItem 的 productName 回退分支一致（4 个名称）；
 * - goodsCost = Σ(售价 − 利润) × 数量，对应逐行 itemRevenue.subtract(itemProfit) 累加；
 * - orderCount 为区间内独立订单数，对应 seenOrderIds.size；
 * - 券面消费行不排除（金额侧计入），与 aggregateSales 一致。
 */
async function fetchProfitPreviousTotals(
  prisma: PrismaService,
  storeId: number,
  previousRange: ProfitDateRange | null,
): Promise<ProfitPreviousTotals> {
  if (previousRange === null) {
    return EMPTY_PROFIT_PREVIOUS_TOTALS;
  }

  const start = new Date(previousRange.start);
  const end = new Date(previousRange.end);
  const rows = await prisma.$queryRaw<ProfitPreviousTotalsRow[]>`
    SELECT
      sales.revenue,
      sales.profit,
      sales.goods_cost,
      sales.order_count,
      costs.total_cost
    FROM (
      SELECT
        COALESCE(SUM(soi.sale_price * soi.quantity), 0) AS revenue,
        COALESCE(SUM(soi.profit * soi.quantity), 0) AS profit,
        COALESCE(SUM((soi.sale_price - soi.profit) * soi.quantity), 0) AS goods_cost,
        COUNT(DISTINCT so.id) AS order_count
      FROM sale_order_items soi
      INNER JOIN sale_orders so ON so.id = soi.order_id
      WHERE soi.store_id = ${storeId}
        AND so.date >= ${start}
        AND so.date <= ${end}
        AND soi.product_name NOT IN ('预付款', '预付抵扣', '续费抵扣', '自助下单抵扣')
    ) sales
    CROSS JOIN (
      SELECT COALESCE(SUM(cr.amount), 0) AS total_cost
      FROM cost_records cr
      WHERE cr.store_id = ${storeId}
        AND cr.date >= ${start}
        AND cr.date <= ${end}
    ) costs
  `;

  const row = rows[0];
  return {
    revenueCents: Number(row?.revenue ?? 0),
    profitCents: Number(row?.profit ?? 0),
    goodsCostCents: Number(row?.goods_cost ?? 0),
    orderCount: Number(row?.order_count ?? 0),
    totalCostCents: Number(row?.total_cost ?? 0),
  };
}

/**
 * 只拉取当期明细；上一周期改为一条 SQL 标量聚合，三路并发。
 * 这样行数、DB 传输量与后续 JS 聚合量都不再随「上一周期」翻倍。
 */
export async function fetchProfitRows(
  prisma: PrismaService,
  storeId: number,
  currentRange: ProfitAccessibleRange,
  previousRange: ProfitAccessibleRange | null,
  pageSize = PROFIT_DETAIL_PAGE_SIZE,
): Promise<ProfitRowsSnapshot> {
  const [saleRows, costRows, previousTotals] = await Promise.all([
    fetchAllSaleOrderItems(prisma, storeId, currentRange, pageSize),
    fetchAllCostRecords(prisma, storeId, currentRange, pageSize),
    fetchProfitPreviousTotals(prisma, storeId, previousRange),
  ]);

  return { saleRows, costRows, previousTotals };
}

/** 翻页游标：取上一页末行的排序键，与各自 orderBy 严格对齐 */
interface RowCursor {
  date: Date;
  id: number;
}

function buildSaleOrderItemCursorWhere(
  cursor: RowCursor | null,
): Prisma.SaleOrderItemWhereInput {
  if (!cursor) {
    return {};
  }

  return {
    OR: [
      { order: { date: { gt: cursor.date } } },
      { order: { date: cursor.date }, id: { gt: cursor.id } },
    ],
  };
}

function buildCostRecordCursorWhere(
  cursor: RowCursor | null,
): Prisma.CostRecordWhereInput {
  if (!cursor) {
    return {};
  }

  return {
    OR: [
      { date: { gt: cursor.date } },
      { date: cursor.date, id: { gt: cursor.id } },
    ],
  };
}

/**
 * 分页拉取全部销售订单行。
 *
 * 此前单次 findMany 带 take 上限会静默截断，当查询窗口内订单行数超过上限时，
 * 近期（当期）数据被丢弃，导致利润统计口径错误。这里持续翻页直至取尽，
 * 保证后续聚合结果完整、正确。
 *
 * 翻页用（订单日期, id）游标而非 skip：skip 越往后 PG 需要重扫并丢弃的行越多，
 * n 行按 pageSize 翻页的累计扫描量是 O(n² / pageSize)（年维度大店可达千万行级）；
 * 游标让每页都从索引上的固定位置续读，累计扫描量降为 O(n)。行序与 skip 完全一致，
 * 因此 rankMap 依赖的「首行价格快照」语义不受影响。
 */
async function fetchAllSaleOrderItems(
  prisma: PrismaService,
  storeId: number,
  range: ProfitDateRange,
  pageSize: number,
): Promise<SaleOrderItemRow[]> {
  const { where: baseWhere, orderBy } = buildSaleOrderItemQuery(storeId, range);
  const rows: SaleOrderItemRow[] = [];
  let cursor: RowCursor | null = null;
  let hasMore = true;

  while (hasMore) {
    // 显式标注：游标 where 展开后 Prisma 无法自推断 payload，会退化成 any
    const page: SaleOrderItemRow[] = await prisma.saleOrderItem.findMany({
      where: {
        ...baseWhere,
        ...buildSaleOrderItemCursorWhere(cursor),
      },
      orderBy,
      select: PROFIT_DETAIL_SALE_ORDER_ITEM_SELECT,
      take: pageSize,
    });
    rows.push(...page);
    if (page.length < pageSize) {
      hasMore = false;
      break;
    }
    const last = page[page.length - 1];
    cursor = { date: last.order.date, id: last.id };
  }

  return rows;
}

/** 同 fetchAllSaleOrderItems，费用行按（date, id）游标翻页 */
async function fetchAllCostRecords(
  prisma: PrismaService,
  storeId: number,
  range: ProfitDateRange,
  pageSize: number,
): Promise<CostRecordRow[]> {
  const { where: baseWhere, orderBy } = buildCostRecordQuery(storeId, range);
  const rows: CostRecordRow[] = [];
  let cursor: RowCursor | null = null;
  let hasMore = true;

  while (hasMore) {
    const page: CostRecordRow[] = await prisma.costRecord.findMany({
      where: {
        ...baseWhere,
        ...buildCostRecordCursorWhere(cursor),
      },
      orderBy,
      select: PROFIT_DETAIL_COST_RECORD_SELECT,
      take: pageSize,
    });
    rows.push(...page);
    if (page.length < pageSize) {
      hasMore = false;
      break;
    }
    const last = page[page.length - 1];
    cursor = { date: last.date, id: last.id };
  }

  return rows;
}
