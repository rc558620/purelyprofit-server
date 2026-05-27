import { FinanceAccountStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  FinanceAccountRecordWithAmount,
  FinanceAccountsListQueryInput,
} from './finance.types';

const financeAccountRecordSelect = {
  id: true,
  type: true,
  category: true,
  counterpart: true,
  amount: true,
  paidAmount: true,
  remaining: true,
  status: true,
  dueDate: true,
  date: true,
  note: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.FinanceAccountRecordSelect;

function buildFinanceAccountWhere(
  storeId: number,
  query: FinanceAccountsListQueryInput,
): Prisma.FinanceAccountRecordWhereInput {
  const where: Prisma.FinanceAccountRecordWhereInput = {
    storeId,
  };

  if (query.typeFilter && query.typeFilter !== 'all') {
    where.type = query.typeFilter;
  }

  if (query.statusFilter && query.statusFilter !== 'all') {
    where.status = query.statusFilter;
  }

  const trimmedSearchText = query.searchText?.trim();
  if (trimmedSearchText) {
    where.OR = [
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

export async function queryAccountRecords(
  prisma: PrismaService,
  storeId: number,
  query: FinanceAccountsListQueryInput,
): Promise<{ items: FinanceAccountRecordWithAmount[]; total: number }> {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 20;
  const where = buildFinanceAccountWhere(storeId, query);

  const [items, total] = await Promise.all([
    prisma.financeAccountRecord.findMany({
      where,
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: financeAccountRecordSelect,
    }),
    prisma.financeAccountRecord.count({ where }),
  ]);

  return {
    items,
    total,
  };
}

export async function queryAccountStatsRows(
  prisma: PrismaService,
  storeId: number,
): Promise<FinanceAccountRecordWithAmount[]> {
  return prisma.financeAccountRecord.findMany({
    where: { storeId },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    select: financeAccountRecordSelect,
  });
}

export async function createAccountRecordEntity(
  prisma: PrismaService,
  data: Prisma.FinanceAccountRecordCreateArgs['data'],
): Promise<FinanceAccountRecordWithAmount> {
  return prisma.financeAccountRecord.create({
    data,
    select: financeAccountRecordSelect,
  });
}

export async function findAccountRecord(
  prisma: PrismaService,
  params: { storeId: number; recordId: number },
): Promise<FinanceAccountRecordWithAmount | null> {
  return prisma.financeAccountRecord.findFirst({
    where: {
      id: params.recordId,
      storeId: params.storeId,
    },
    select: financeAccountRecordSelect,
  });
}

export async function findAccountRecordId(
  prisma: PrismaService,
  params: { storeId: number; recordId: number },
): Promise<{ id: number } | null> {
  return prisma.financeAccountRecord.findFirst({
    where: {
      id: params.recordId,
      storeId: params.storeId,
    },
    select: { id: true },
  });
}

export async function updateAccountRecordSettlement(
  prisma: PrismaService,
  params: {
    recordId: number;
    paidAmount: Prisma.Decimal;
    remaining: Prisma.Decimal;
    status: FinanceAccountStatus;
  },
): Promise<FinanceAccountRecordWithAmount> {
  return prisma.financeAccountRecord.update({
    where: { id: params.recordId },
    data: {
      paidAmount: params.paidAmount,
      remaining: params.remaining,
      status: params.status,
    },
    select: financeAccountRecordSelect,
  });
}

export async function deleteAccountRecordEntity(
  prisma: PrismaService,
  recordId: number,
): Promise<void> {
  await prisma.financeAccountRecord.delete({
    where: { id: recordId },
  });
}
