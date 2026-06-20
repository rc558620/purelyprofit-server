import { FinanceAccountStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { withDerivedAccountFields } from './finance-account.domain';
import { DAY_MS } from './finance.constants';
import { buildPaginationState } from './finance-pagination.utils';
import type {
  FinanceAccountRecordWithAmount,
  FinanceAccountsListQueryInput,
  FinanceAccountStatusFilterValue,
} from './finance.types';

export type DerivedFinanceAccountStatusFilter = Exclude<
  FinanceAccountStatusFilterValue,
  'all'
>;

const ZERO_MONEY = new Prisma.Decimal(0);

export function buildDerivedClosedAccountWhere(params: {
  storeId: number;
}): Prisma.FinanceAccountRecordWhereInput {
  return {
    storeId: params.storeId,
    remaining: { lte: ZERO_MONEY },
  };
}

export function buildDerivedFinanceAccountStatusWhere(params: {
  storeId: number;
  status: DerivedFinanceAccountStatusFilter;
  now: number;
}): Prisma.FinanceAccountRecordWhereInput {
  switch (params.status) {
    case 'pending':
      return {
        storeId: params.storeId,
        paidAmount: ZERO_MONEY,
        remaining: { gt: ZERO_MONEY },
        OR: [{ dueDate: null }, { dueDate: { gte: new Date(params.now) } }],
      };
    case 'partial':
      return {
        storeId: params.storeId,
        paidAmount: { gt: ZERO_MONEY },
        remaining: { gt: ZERO_MONEY },
      };
    case 'settled':
      return buildDerivedClosedAccountWhere({
        storeId: params.storeId,
      });
    case 'overdue':
      return {
        storeId: params.storeId,
        dueDate: { lt: new Date(params.now) },
        paidAmount: ZERO_MONEY,
        remaining: { gt: ZERO_MONEY },
      };
  }
}

export function buildDerivedOpenAccountWhere(params: {
  storeId: number;
  now: number;
}): Prisma.FinanceAccountRecordWhereInput {
  return {
    OR: [
      buildDerivedFinanceAccountStatusWhere({
        storeId: params.storeId,
        status: 'pending',
        now: params.now,
      }),
      buildDerivedFinanceAccountStatusWhere({
        storeId: params.storeId,
        status: 'partial',
        now: params.now,
      }),
      buildDerivedFinanceAccountStatusWhere({
        storeId: params.storeId,
        status: 'overdue',
        now: params.now,
      }),
    ],
  };
}

/**
 * 构建即将到期账款的查询条件：到期日在 [now, now + withinDays) 之间，且尚未结清。
 * 已逾期的不属于"即将到期"，已逾期的由 overdue 查询覆盖。
 */
export function buildUpcomingDueAccountWhere(params: {
  storeId: number;
  now: number;
  withinDays: number;
}): Prisma.FinanceAccountRecordWhereInput {
  const dueBefore = new Date(params.now + params.withinDays * DAY_MS);

  return {
    storeId: params.storeId,
    dueDate: {
      gte: new Date(params.now),
      lt: dueBefore,
    },
    remaining: { gt: ZERO_MONEY },
  };
}

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
  const conditions: Prisma.FinanceAccountRecordWhereInput[] = [{ storeId }];

  if (query.typeFilter && query.typeFilter !== 'all') {
    conditions.push({ type: query.typeFilter });
  }

  if (query.statusFilter && query.statusFilter !== 'all') {
    conditions.push(
      query.statusFilter === 'settled'
        ? buildDerivedClosedAccountWhere({
            storeId,
          })
        : buildDerivedFinanceAccountStatusWhere({
            storeId,
            status: query.statusFilter,
            now: Date.now(),
          }),
    );
  }

  const trimmedSearchText = query.searchText?.trim();
  if (trimmedSearchText) {
    conditions.push({
      OR: [
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
      ],
    });
  }

  return conditions.length === 1 ? conditions[0] : { AND: conditions };
}

export async function queryAccountRecords(
  prisma: PrismaService,
  storeId: number,
  query: FinanceAccountsListQueryInput,
): Promise<{ items: FinanceAccountRecordWithAmount[]; total: number }> {
  const where = buildFinanceAccountWhere(storeId, query);
  const pageState = buildPaginationState(query.page, query.pageSize);

  const [total, records] = await Promise.all([
    prisma.financeAccountRecord.count({ where }),
    prisma.financeAccountRecord.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      select: financeAccountRecordSelect,
      skip: (pageState.page - 1) * pageState.pageSize,
      take: pageState.pageSize,
    }),
  ]);

  const derivedRecords = records.map((record) =>
    withDerivedAccountFields(record),
  );

  return {
    items: derivedRecords,
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
  prisma: PrismaService | Prisma.TransactionClient,
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
  prisma: PrismaService | Prisma.TransactionClient,
  params: {
    storeId: number;
    recordId: number;
    expectedPaidAmount: Prisma.Decimal;
    paidAmount: Prisma.Decimal;
    remaining: Prisma.Decimal;
    status: FinanceAccountStatus;
  },
): Promise<FinanceAccountRecordWithAmount | null> {
  const updateResult = await prisma.financeAccountRecord.updateMany({
    where: {
      id: params.recordId,
      storeId: params.storeId,
      paidAmount: params.expectedPaidAmount,
    },
    data: {
      paidAmount: params.paidAmount,
      remaining: params.remaining,
      status: params.status,
    },
  });

  if (updateResult.count === 0) {
    return null;
  }

  return prisma.financeAccountRecord.findFirst({
    where: {
      id: params.recordId,
      storeId: params.storeId,
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
