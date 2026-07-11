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

/**
 * 分页拉取全部销售订单行。
 *
 * 此前单次 findMany 带 take 上限会静默截断，当查询窗口内订单行数超过上限时，
 * 近期（当期）数据被丢弃，导致利润统计口径错误。这里持续翻页直至取尽，
 * 保证后续聚合结果完整、正确。
 */
async function fetchAllSaleOrderItems(
  prisma: PrismaService,
  storeId: number,
  range: ProfitDateRange,
  pageSize: number,
): Promise<SaleOrderItemRow[]> {
  const rows: SaleOrderItemRow[] = [];
  let skip = 0;
  let hasMore = true;

  while (hasMore) {
    const page = await prisma.saleOrderItem.findMany({
      ...buildSaleOrderItemQuery(storeId, range),
      select: PROFIT_DETAIL_SALE_ORDER_ITEM_SELECT,
      skip,
      take: pageSize,
    });
    rows.push(...page);
    if (page.length < pageSize) {
      hasMore = false;
      break;
    }
    skip += pageSize;
  }

  return rows;
}

async function fetchAllCostRecords(
  prisma: PrismaService,
  storeId: number,
  range: ProfitDateRange,
  pageSize: number,
): Promise<CostRecordRow[]> {
  const rows: CostRecordRow[] = [];
  let skip = 0;
  let hasMore = true;

  while (hasMore) {
    const page = await prisma.costRecord.findMany({
      ...buildCostRecordQuery(storeId, range),
      select: PROFIT_DETAIL_COST_RECORD_SELECT,
      skip,
      take: pageSize,
    });
    rows.push(...page);
    if (page.length < pageSize) {
      hasMore = false;
      break;
    }
    skip += pageSize;
  }

  return rows;
}
