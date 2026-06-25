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
  maxPageSize = 5000,
): Promise<{ saleRows: SaleOrderItemRow[]; costRows: CostRecordRow[] }> {
  const queryRange = resolveProfitQueryRange(currentRange, previousRange);
  const [saleRows, costRows] = await Promise.all([
    prisma.saleOrderItem.findMany({
      ...buildSaleOrderItemQuery(storeId, queryRange),
      select: PROFIT_DETAIL_SALE_ORDER_ITEM_SELECT,
      take: maxPageSize,
    }),
    prisma.costRecord.findMany({
      ...buildCostRecordQuery(storeId, queryRange),
      select: PROFIT_DETAIL_COST_RECORD_SELECT,
      take: maxPageSize,
    }),
  ]);

  return { saleRows, costRows };
}
