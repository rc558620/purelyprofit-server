import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';
import {
  BUSINESS_ANALYSIS_COST_RECORD_SELECT,
  BUSINESS_ANALYSIS_SALE_ORDER_ITEM_SELECT,
  type BusinessAnalysisAccessibleRange,
  type BusinessAnalysisRange,
  type CostRecordCostRow,
  type SaleOrderItemRow,
} from './business-analysis.types';
import { resolveAnalysisQueryRange } from './business-analysis.utils';

export function buildSaleOrderItemQuery(
  storeId: number,
  range: BusinessAnalysisRange,
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
  range: BusinessAnalysisRange,
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

export async function fetchBusinessAnalysisRows(
  prisma: PrismaService,
  storeId: number,
  currentRange: BusinessAnalysisAccessibleRange,
  previousRange: BusinessAnalysisAccessibleRange,
): Promise<{ saleItems: SaleOrderItemRow[]; costRows: CostRecordCostRow[] }> {
  const queryRange = resolveAnalysisQueryRange(currentRange, previousRange);
  const [saleItems, costRows] = await Promise.all([
    prisma.saleOrderItem.findMany({
      ...buildSaleOrderItemQuery(storeId, queryRange),
      select: BUSINESS_ANALYSIS_SALE_ORDER_ITEM_SELECT,
    }),
    prisma.costRecord.findMany({
      ...buildCostRecordQuery(storeId, queryRange),
      select: BUSINESS_ANALYSIS_COST_RECORD_SELECT,
    }),
  ]);

  return {
    saleItems,
    costRows,
  };
}
