import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  FinanceAccountRecordWithAmount,
  FinanceCashFlowRecordWithAmount,
} from './finance.types';

export async function queryOverviewCashFlowRecords(
  prisma: PrismaService,
  params: {
    storeId: number;
    start: number;
    end: number;
  },
): Promise<Array<{ category: string; amount: Prisma.Decimal; date: Date }>> {
  return prisma.financeCashFlowRecord.findMany({
    where: {
      storeId: params.storeId,
      date: {
        gte: new Date(params.start),
        lte: new Date(params.end),
      },
    },
    select: {
      category: true,
      amount: true,
      date: true,
    },
    orderBy: [{ date: 'asc' }, { id: 'asc' }],
  });
}

export async function queryFinanceReportData(
  prisma: PrismaService,
  params: {
    storeId: number;
    currentRange: { start: number; end: number; empty: boolean };
    previousRange: { start: number; end: number; empty: boolean } | null;
  },
): Promise<{
  currentCashFlowRecords: FinanceCashFlowRecordWithAmount[];
  previousCashFlowRecords: FinanceCashFlowRecordWithAmount[];
  accountRecords: FinanceAccountRecordWithAmount[];
}> {
  const [currentCashFlowRecords, previousCashFlowRecords, accountRecords] =
    await Promise.all([
      params.currentRange.empty
        ? Promise.resolve<FinanceCashFlowRecordWithAmount[]>([])
        : prisma.financeCashFlowRecord.findMany({
            where: {
              storeId: params.storeId,
              date: {
                gte: new Date(params.currentRange.start),
                lte: new Date(params.currentRange.end),
              },
            },
            orderBy: [{ date: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
          }),
      params.previousRange && !params.previousRange.empty
        ? prisma.financeCashFlowRecord.findMany({
            where: {
              storeId: params.storeId,
              date: {
                gte: new Date(params.previousRange.start),
                lte: new Date(params.previousRange.end),
              },
            },
          })
        : Promise.resolve<FinanceCashFlowRecordWithAmount[]>([]),
      prisma.financeAccountRecord.findMany({
        where: { storeId: params.storeId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    ]);

  return {
    currentCashFlowRecords,
    previousCashFlowRecords,
    accountRecords,
  };
}
