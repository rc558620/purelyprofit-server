import { FinanceAccountStatus, Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
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

const ZERO_MONEY = 0; // Step 3: Int（分）

/**
 * 刷新逾期状态：将数据库中 status=pending 或 partial 且 dueDate < now 的记录更新为 overdue。
 * 由于 overdue 是时间依赖的派生状态，数据库 status 可能在时间流逝后与事实不一致，
 * 需要在查询前同步刷新，确保后续 WHERE status = 'overdue' 能命中所有逾期记录。
 *
 * 该函数设计为幂等：仅更新 pending/partial 中已过 dueDate 且未结清的记录，
 * 不影响 status=overdue/settled 的记录。
 */
async function refreshOverdueStatuses(
  prisma: PrismaService,
  storeId: number,
): Promise<void> {
  const now = new Date();
  await prisma.financeAccountRecord.updateMany({
    where: {
      storeId,
      status: {
        in: [FinanceAccountStatus.pending, FinanceAccountStatus.partial],
      },
      dueDate: { lt: now, not: null },
      remaining: { gt: ZERO_MONEY },
    },
    data: {
      status: FinanceAccountStatus.overdue,
    },
  });
}

/**
 * 基于数据库 status 字段构建 where 条件（走索引）。
 *
 * 状态口径说明：
 * - pending / partial / settled / overdue 均在写入时落库为事实字段
 * - overdue 需在查询前通过 refreshOverdueStatuses 刷新，因为它是时间依赖的派生状态
 * - 展示层仍通过 withDerivedAccountFields 兜底，防止数据库 status 与事实短暂不一致
 */
function buildFinanceAccountStatusWhere(
  storeId: number,
  statusFilter: Exclude<FinanceAccountStatusFilterValue, 'all'>,
): Prisma.FinanceAccountRecordWhereInput {
  return {
    storeId,
    status: statusFilter,
  };
}

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
      return buildFinanceAccountStatusWhere(params.storeId, 'pending');
    case 'partial':
      return buildFinanceAccountStatusWhere(params.storeId, 'partial');
    case 'settled':
      return buildFinanceAccountStatusWhere(params.storeId, 'settled');
    case 'overdue':
      return buildFinanceAccountStatusWhere(params.storeId, 'overdue');
  }
}

export function buildDerivedOpenAccountWhere(params: {
  storeId: number;
  now: number;
}): Prisma.FinanceAccountRecordWhereInput {
  return {
    storeId: params.storeId,
    status: {
      in: [
        FinanceAccountStatus.pending,
        FinanceAccountStatus.partial,
        FinanceAccountStatus.overdue,
      ],
    },
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

/** 根据筛选参数计算日期范围，返回 null 表示不限时间 */
function getDateRangeFromQuery(
  query: FinanceAccountsListQueryInput,
): { start: Date; end: Date } | null {
  if (!query.datePeriod || query.datePeriod === 'all') {
    return null;
  }

  if (query.datePeriod === 'custom_day') {
    const y = query.customDayYear ?? 2000;
    const m = (query.customDayMonth ?? 1) - 1;
    const d = query.customDayDay ?? 1;
    const start = new Date(y, m, d, 0, 0, 0, 0);
    const end = new Date(y, m, d, 23, 59, 59, 999);
    return { start, end };
  }

  if (query.datePeriod === 'custom_range') {
    const sy = query.customRangeStartYear ?? 2000;
    const sm = (query.customRangeStartMonth ?? 1) - 1;
    const sd = query.customRangeStartDay ?? 1;
    const ey = query.customRangeEndYear ?? 2100;
    const em = (query.customRangeEndMonth ?? 12) - 1;
    const ed = query.customRangeEndDay ?? 31;
    const start = new Date(sy, sm, sd, 0, 0, 0, 0);
    const end = new Date(ey, em, ed, 23, 59, 59, 999);
    return { start, end: start > end ? start : end };
  }

  return null;
}

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
      buildFinanceAccountStatusWhere(storeId, query.statusFilter),
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

  const dateRange = getDateRangeFromQuery(query);
  if (dateRange) {
    conditions.push({
      date: { gte: dateRange.start, lte: dateRange.end },
    });
  }

  return conditions.length === 1 ? conditions[0] : { AND: conditions };
}

export async function queryAccountRecords(
  prisma: PrismaService,
  storeId: number,
  query: FinanceAccountsListQueryInput,
): Promise<{ items: FinanceAccountRecordWithAmount[]; total: number }> {
  // 查询前刷新逾期状态，确保数据库 status 与事实一致
  await refreshOverdueStatuses(prisma, storeId);

  const where = buildFinanceAccountWhere(storeId, query);
  const pageState = buildPaginationState(query.page, query.pageSize);

  const [total, records] = await Promise.all([
    prisma.financeAccountRecord.count({ where }),
    prisma.financeAccountRecord.findMany({
      where,
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }, { id: 'desc' }],
      select: financeAccountRecordSelect,
      skip: (pageState.page - 1) * pageState.pageSize,
      take: pageState.pageSize,
    }),
  ]);

  // 展示层仍通过 withDerivedAccountFields 兜底，确保 remaining 和 status 与事实一致
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
  // 统计前也刷新逾期状态
  await refreshOverdueStatuses(prisma, storeId);

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
    expectedPaidAmount: number; // Step 3: Int（分）
    paidAmount: number; // Step 3: Int（分）
    remaining: number; // Step 3: Int（分）
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
  storeId: number,
  recordId: number,
): Promise<void> {
  await prisma.financeAccountRecord.deleteMany({
    where: { id: recordId, storeId },
  });
}
