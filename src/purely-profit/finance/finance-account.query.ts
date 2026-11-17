import { FinanceAccountStatus, Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import { DAY_MS } from './finance.constants';
import { getShanghaiDayStartMs } from './finance-date.utils';
import { makeShanghaiMs } from '../../shared/shanghai-time.utils';
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
 * 逾期时点：到期日当天仍属正常，次日零点起才算逾期。
 * dueDate 为到期日零点时间戳，故判定为 dueDate + DAY_MS <= now。
 */
export function getOverdueAtMs(now: number): number {
  return now - DAY_MS;
}

/** 未逾期：无到期日，或尚未越过逾期时点 */
function buildNotOverdueWhere(
  now: number,
): Prisma.FinanceAccountRecordWhereInput['OR'] {
  return [
    { dueDate: null },
    { dueDate: { gt: new Date(getOverdueAtMs(now)) } },
  ];
}

/**
 * 按「派生口径」下推状态查询条件，与 domain 层 deriveAccountFields 严格对齐。
 *
 * 背景：overdue 是时间依赖的派生状态，会随时间流逝自动产生，数据库 status 字段
 * 只是写入那一刻的快照。此前该查询直接命中 DB status，依赖调用方先执行
 * refreshOverdueStatuses 写库刷新；而通知、首页、Pulse 等外部模块并不会刷新，
 * 导致这些场景查不到逾期账款（漏报）。
 *
 * 这里改为直接下推派生条件，任何模块都无需先写库刷新，也不会因快照过期而漏报：
 * - settled : remaining <= 0
 * - overdue : remaining > 0 且 dueDate < now
 * - partial : remaining > 0、已收付 > 0 且未逾期
 * - pending : remaining > 0、未收付且未逾期
 */
export function buildDerivedFinanceAccountStatusWhere(params: {
  storeId: number;
  status: DerivedFinanceAccountStatusFilter;
  now: number;
}): Prisma.FinanceAccountRecordWhereInput {
  switch (params.status) {
    case 'settled':
      return {
        storeId: params.storeId,
        remaining: { lte: ZERO_MONEY },
      };
    case 'overdue':
      return {
        storeId: params.storeId,
        remaining: { gt: ZERO_MONEY },
        dueDate: { lte: new Date(getOverdueAtMs(params.now)), not: null },
      };
    case 'partial':
      return {
        storeId: params.storeId,
        remaining: { gt: ZERO_MONEY },
        paidAmount: { gt: ZERO_MONEY },
        OR: buildNotOverdueWhere(params.now),
      };
    case 'pending':
      return {
        storeId: params.storeId,
        remaining: { gt: ZERO_MONEY },
        paidAmount: { lte: ZERO_MONEY },
        OR: buildNotOverdueWhere(params.now),
      };
  }
}

/** 未结清账款 = 仍有剩余金额，与展示层 settled 判定互补 */
export function buildDerivedOpenAccountWhere(params: {
  storeId: number;
}): Prisma.FinanceAccountRecordWhereInput {
  return {
    storeId: params.storeId,
    remaining: { gt: ZERO_MONEY },
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
  // 下界取今天零点而非当前时刻：逾期判定已改为"次日零点才算逾期"，
  // 若这里仍以 now 为下界，"今天到期"的账款会既不算逾期、也进不了即将到期提醒。
  const dayStart = getShanghaiDayStartMs(params.now);
  const dueBefore = new Date(dayStart + params.withinDays * DAY_MS);

  return {
    storeId: params.storeId,
    dueDate: {
      gte: new Date(dayStart),
      lt: dueBefore,
    },
    remaining: { gt: ZERO_MONEY },
  };
}

export const financeAccountRecordSelect = {
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

/**
 * 根据筛选参数计算日期范围，返回 null 表示不限时间。
 *
 * 年月日一律按上海时区解析（makeShanghaiMs），不依赖 Node 进程本地时区，
 * 否则容器以 UTC 部署时自定义日期筛选会整体偏移，与其余模块的上海口径错位。
 */
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
    const startMs = makeShanghaiMs(y, m, d);
    return {
      start: new Date(startMs),
      end: new Date(startMs + DAY_MS - 1),
    };
  }

  if (query.datePeriod === 'custom_range') {
    const sy = query.customRangeStartYear ?? 2000;
    const sm = (query.customRangeStartMonth ?? 1) - 1;
    const sd = query.customRangeStartDay ?? 1;
    const ey = query.customRangeEndYear ?? 2100;
    const em = (query.customRangeEndMonth ?? 12) - 1;
    const ed = query.customRangeEndDay ?? 31;
    const startMs = makeShanghaiMs(sy, sm, sd);
    const endMs = makeShanghaiMs(ey, em, ed) + DAY_MS - 1;
    return {
      start: new Date(startMs),
      end: new Date(Math.max(startMs, endMs)),
    };
  }

  return null;
}

export function buildFinanceAccountWhere(
  storeId: number,
  query: FinanceAccountsListQueryInput,
  now: number,
): Prisma.FinanceAccountRecordWhereInput {
  const conditions: Prisma.FinanceAccountRecordWhereInput[] = [{ storeId }];

  if (query.typeFilter && query.typeFilter !== 'all') {
    conditions.push({ type: query.typeFilter });
  }

  if (query.statusFilter && query.statusFilter !== 'all') {
    conditions.push(
      buildDerivedFinanceAccountStatusWhere({
        storeId,
        status: query.statusFilter,
        now,
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

  const dateRange = getDateRangeFromQuery(query);
  if (dateRange) {
    conditions.push({
      date: { gte: dateRange.start, lte: dateRange.end },
    });
  }

  return conditions.length === 1 ? conditions[0] : { AND: conditions };
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

/**
 * 删除「未结清」账款：把「已结清不可删」下推成删除条件，单条 SQL 完成校验与删除。
 *
 * 原实现是 findFirst → 内存派生状态 → deleteMany 的读后写：
 * 期间若并发登记收付把剩余金额清零，已结清的账款仍会被删掉。
 * 这里用 `remaining > 0` 作为前置条件，影响行数即判定结果，不再有竞态窗口。
 *
 * @returns true 表示删除成功；false 表示记录不存在或已结清，由调用方区分 404 / 409
 */
export async function deleteOpenAccountRecordEntity(
  prisma: PrismaService,
  params: { storeId: number; recordId: number },
): Promise<boolean> {
  const result = await prisma.financeAccountRecord.deleteMany({
    where: {
      id: params.recordId,
      storeId: params.storeId,
      remaining: { gt: ZERO_MONEY },
    },
  });

  return result.count > 0;
}
