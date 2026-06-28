import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  FinanceCashFlowDirectionValue,
  FinanceCashFlowFilterRange,
  FinanceCashFlowRecordWithAmount,
  FinanceCashFlowStatsRow,
} from './finance.types';

const CASH_FLOW_RECORD_PAGE_SELECT = {
  id: true,
  direction: true,
  category: true,
  title: true,
  amount: true,
  payment: true,
  note: true,
  date: true,
  createdAt: true,
} satisfies Prisma.FinanceCashFlowRecordSelect;

export async function queryCashFlowRecordPage(
  prisma: PrismaService,
  params: {
    where: Prisma.FinanceCashFlowRecordWhereInput;
    page: number;
    pageSize: number;
  },
): Promise<{ total: number; records: FinanceCashFlowRecordWithAmount[] }> {
  const [total, records] = await Promise.all([
    prisma.financeCashFlowRecord.count({ where: params.where }),
    prisma.financeCashFlowRecord.findMany({
      where: params.where,
      select: CASH_FLOW_RECORD_PAGE_SELECT,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
    }),
  ]);

  return { total, records };
}

export async function queryCashFlowStatsRows(
  prisma: PrismaService,
  params: {
    storeId: number;
    range: FinanceCashFlowFilterRange | { start: number; end: number };
    directionFilter?: FinanceCashFlowDirectionValue;
  },
): Promise<FinanceCashFlowStatsRow[]> {
  const where: Prisma.FinanceCashFlowRecordWhereInput = {
    storeId: params.storeId,
    date: {
      gte: new Date(params.range.start),
      lte: new Date(params.range.end),
    },
  };

  if (params.directionFilter) {
    where.direction = params.directionFilter;
  }

  return prisma.financeCashFlowRecord.findMany({
    where,
    select: {
      direction: true,
      amount: true,
    },
  });
}

export async function createCashFlowRecordEntity(
  prisma: PrismaService,
  data: Prisma.FinanceCashFlowRecordCreateArgs['data'],
): Promise<FinanceCashFlowRecordWithAmount> {
  return prisma.financeCashFlowRecord.create({ data });
}

export async function findCashFlowRecordOwnership(
  prisma: PrismaService,
  params: { storeId: number; recordId: number },
): Promise<{ id: number; saleOrderId: number | null } | null> {
  return prisma.financeCashFlowRecord.findFirst({
    where: {
      id: params.recordId,
      storeId: params.storeId,
    },
    select: {
      id: true,
      saleOrderId: true,
    },
  });
}

export async function deleteCashFlowRecordEntity(
  prisma: PrismaService,
  recordId: number,
): Promise<void> {
  await prisma.financeCashFlowRecord.delete({
    where: { id: recordId },
  });
}
