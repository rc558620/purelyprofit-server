import { type FinanceReconciliationStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  FinanceReconciliationRecordWithItems,
  FinanceReconciliationsListQueryInput,
} from './finance.types';

const FINANCE_RECONCILIATION_RECORD_INCLUDE = {
  items: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  },
} satisfies Prisma.FinanceReconciliationRecordInclude;

function buildFinanceReconciliationWhere(
  storeId: number,
  query: FinanceReconciliationsListQueryInput,
): Prisma.FinanceReconciliationRecordWhereInput {
  const where: Prisma.FinanceReconciliationRecordWhereInput = {
    storeId,
  };

  if (query.statusFilter && query.statusFilter !== 'all') {
    where.status = query.statusFilter;
  }

  if (query.typeFilter && query.typeFilter !== 'all') {
    where.type = query.typeFilter;
  }

  const trimmedSearchText = query.searchText?.trim();
  if (trimmedSearchText) {
    where.OR = [
      {
        title: {
          contains: trimmedSearchText,
          mode: 'insensitive',
        },
      },
      {
        counterpart: {
          contains: trimmedSearchText,
          mode: 'insensitive',
        },
      },
      {
        note: {
          contains: trimmedSearchText,
          mode: 'insensitive',
        },
      },
    ];
  }

  return where;
}

export async function queryReconciliationRecords(
  prisma: PrismaService,
  storeId: number,
): Promise<FinanceReconciliationRecordWithItems[]> {
  return prisma.financeReconciliationRecord.findMany({
    where: { storeId },
    include: FINANCE_RECONCILIATION_RECORD_INCLUDE,
    orderBy: [{ date: 'desc' }, { id: 'desc' }],
  });
}

export async function queryReconciliationRecordPage(
  prisma: PrismaService,
  storeId: number,
  query: FinanceReconciliationsListQueryInput,
): Promise<{ items: FinanceReconciliationRecordWithItems[]; total: number }> {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 20;
  const where = buildFinanceReconciliationWhere(storeId, query);

  const [items, total] = await Promise.all([
    prisma.financeReconciliationRecord.findMany({
      where,
      include: FINANCE_RECONCILIATION_RECORD_INCLUDE,
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.financeReconciliationRecord.count({ where }),
  ]);

  return {
    items,
    total,
  };
}

export async function createReconciliationRecordEntity(
  prisma: PrismaService,
  data: Prisma.FinanceReconciliationRecordCreateArgs['data'],
): Promise<FinanceReconciliationRecordWithItems> {
  return prisma.financeReconciliationRecord.create({
    data,
    include: FINANCE_RECONCILIATION_RECORD_INCLUDE,
  });
}

export async function findReconciliationRecord(
  prisma: PrismaService,
  params: { storeId: number; recordId: number },
): Promise<FinanceReconciliationRecordWithItems | null> {
  return prisma.financeReconciliationRecord.findFirst({
    where: {
      id: params.recordId,
      storeId: params.storeId,
    },
    include: FINANCE_RECONCILIATION_RECORD_INCLUDE,
  });
}

export async function findReconciliationRecordId(
  prisma: PrismaService,
  params: { storeId: number; recordId: number },
): Promise<{ id: number } | null> {
  return prisma.financeReconciliationRecord.findFirst({
    where: {
      id: params.recordId,
      storeId: params.storeId,
    },
    select: { id: true },
  });
}

export async function updateReconciliationConfirmation(
  prisma: PrismaService,
  params: {
    recordId: number;
    status: FinanceReconciliationStatus;
    adjustNote: string | null;
  },
): Promise<FinanceReconciliationRecordWithItems> {
  return prisma.financeReconciliationRecord.update({
    where: { id: params.recordId },
    data: {
      status: params.status,
      adjustNote: params.adjustNote,
    },
    include: FINANCE_RECONCILIATION_RECORD_INCLUDE,
  });
}

export async function deleteReconciliationRecordEntity(
  prisma: PrismaService,
  recordId: number,
): Promise<void> {
  await prisma.financeReconciliationRecord.delete({
    where: { id: recordId },
  });
}
