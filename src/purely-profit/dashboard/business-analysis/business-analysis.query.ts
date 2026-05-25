import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';
import {
  BUSINESS_ANALYSIS_CASH_FLOW_COST_SELECT,
  BUSINESS_ANALYSIS_SALE_ORDER_ITEM_SELECT,
  type BusinessAnalysisAccessibleRange,
  type BusinessAnalysisRange,
  type CashFlowCostRow,
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

export function buildCashFlowCostQuery(
  storeId: number,
  range: BusinessAnalysisRange,
): Pick<Prisma.FinanceCashFlowRecordFindManyArgs, 'where' | 'orderBy'> {
  return {
    where: {
      storeId,
      direction: 'expense',
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
): Promise<{ saleItems: SaleOrderItemRow[]; costRows: CashFlowCostRow[] }> {
  const queryRange = resolveAnalysisQueryRange(currentRange, previousRange);
  const [saleItems, costRows] = await Promise.all([
    prisma.saleOrderItem.findMany({
      ...buildSaleOrderItemQuery(storeId, queryRange),
      select: BUSINESS_ANALYSIS_SALE_ORDER_ITEM_SELECT,
    }),
    prisma.financeCashFlowRecord.findMany({
      ...buildCashFlowCostQuery(storeId, queryRange),
      select: BUSINESS_ANALYSIS_CASH_FLOW_COST_SELECT,
    }),
  ]);

  return {
    saleItems,
    costRows,
  };
}
