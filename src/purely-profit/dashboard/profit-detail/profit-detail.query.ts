import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';
import {
  PROFIT_DETAIL_COST_RECORD_SELECT,
  PROFIT_DETAIL_SALE_ORDER_ITEM_SELECT,
  type CostRecordRow,
  type ProfitAccessibleRange,
  type ProfitDateRange,
  type SaleOrderItemRow,
} from './profit-detail.types';
import { resolveProfitQueryRange } from './profit-detail.utils';

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

export async function fetchProfitRows(
  prisma: PrismaService,
  storeId: number,
  currentRange: ProfitAccessibleRange,
  previousRange: ProfitAccessibleRange,
  pageSize = 5000,
): Promise<{ saleRows: SaleOrderItemRow[]; costRows: CostRecordRow[] }> {
  const queryRange = resolveProfitQueryRange(currentRange, previousRange);
  const [saleRows, costRows] = await Promise.all([
    fetchAllSaleOrderItems(prisma, storeId, queryRange, pageSize),
    fetchAllCostRecords(prisma, storeId, queryRange, pageSize),
  ]);

  return { saleRows, costRows };
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
