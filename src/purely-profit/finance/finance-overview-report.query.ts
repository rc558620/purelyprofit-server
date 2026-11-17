import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { buildDerivedOpenAccountWhere } from './finance-account.query';
import {
  FINANCE_REPORT_ACCOUNT_ROW_LIMIT,
  FINANCE_REPORT_EXPORT_BATCH_SIZE,
} from './finance.constants';
import type {
  FinanceCashFlowRecordWithAmount,
  FinanceCashFlowStatsRow,
  FinanceReportAccountRow,
} from './finance.types';

/**
 * 报表明细行只取 CSV / 表格真正渲染的列。
 *
 * `note` 在报表任何一列都不出现，但明细单页最多 5000 行、导出还要逐批读取：
 * 少带一个长文本列可同时压小 SQL 传输量、Redis 缓存值与导出链路内存。
 */
const financeReportCashFlowSelect = {
  id: true,
  direction: true,
  category: true,
  title: true,
  amount: true,
  payment: true,
  date: true,
  createdAt: true,
} satisfies Prisma.FinanceCashFlowRecordSelect;

/**
 * 报表账款行只取渲染所需列。
 *
 * `note` / `category` / `date` / `updatedAt` 在报表里没有任何一列用到：
 * 报表结果会整体写进 Redis（TTL 120s），每行少带 4 列可直接压小缓存值与响应体。
 */
const financeReportAccountSelect = {
  id: true,
  type: true,
  counterpart: true,
  amount: true,
  paidAmount: true,
  remaining: true,
  status: true,
  dueDate: true,
  createdAt: true,
} satisfies Prisma.FinanceAccountRecordSelect;

export type FinanceReportCashFlowRow = Pick<
  FinanceCashFlowRecordWithAmount,
  | 'id'
  | 'date'
  | 'createdAt'
  | 'title'
  | 'direction'
  | 'category'
  | 'amount'
  | 'payment'
>;

export type FinanceReportCashFlowTotals = Array<
  Pick<FinanceCashFlowStatsRow, 'direction' | 'amount'>
>;

/** 未结清账款合计（数据库分） */
export interface FinanceReportOpenAccountTotals {
  receivableRemaining: number;
  payableRemaining: number;
}

/**
 * 报表「概况」侧数据：全部由 SQL 聚合产出，与明细分页上限无关。
 *
 * 与明细行拆成两条查询的原因：概况会单独进一个缓存 key（体积只有 7 个数字），
 * 明细行进另一个 key（940 KB 级别、TTL 更短）。两者必须能独立取数，
 * 否则拆 key 只是把一个 940 KB 的值复制两遍。
 */
export interface FinanceReportSummaryData {
  /** 本期收支汇总，SQL 聚合，不受明细分页上限影响 */
  currentCashFlowTotals: FinanceReportCashFlowTotals;
  /** 本期真实流水条数（与金额同一次聚合产出），不受明细分页上限影响 */
  currentCashFlowCount: number;
  /** 上期收支汇总，SQL 聚合 */
  previousCashFlowTotals: FinanceReportCashFlowTotals;
  /** 未结清账款合计，SQL 聚合，不受明细行上限影响 */
  openAccountTotals: FinanceReportOpenAccountTotals;
}

/** 报表「明细行」侧数据：仅用于渲染，受各自上限约束，不得用于汇总 */
export interface FinanceReportRowsData {
  currentCashFlowRecords: FinanceReportCashFlowRow[];
  accountRecords: FinanceReportAccountRow[];
}

/**
 * 按方向聚合区间内流水金额与条数（一次 SQL 聚合）。
 *
 * 汇总必须走 SQL 聚合，不能用明细行在内存里累加 —— 明细行有 maxPageSize 上限，
 * 超限时会导致本期金额被低估、与不受限的上期 SUM 对比后环比严重失真。
 *
 * `_count` 与 `_sum` 同一次扫描产出：条数与金额必然同源，
 * 不必为「本期流水条数」再单独发一条 COUNT。
 */
async function queryCashFlowDirectionTotals(
  prisma: PrismaService,
  params: { storeId: number; start: number; end: number },
): Promise<{ totals: FinanceReportCashFlowTotals; count: number }> {
  const rows = await prisma.financeCashFlowRecord.groupBy({
    by: ['direction'],
    where: {
      storeId: params.storeId,
      date: {
        gte: new Date(params.start),
        lte: new Date(params.end),
      },
    },
    _sum: { amount: true },
    _count: { _all: true },
  });

  return {
    totals: rows.map((row) => ({
      direction: row.direction,
      amount: Number(row._sum.amount ?? 0), // 数据库分，后续统一在 domain 层转元
    })),
    count: rows.reduce((total, row) => total + row._count._all, 0),
  };
}

/** 上期只需要金额汇总，条数不参与环比 */
async function queryCashFlowDirectionTotalsOnly(
  prisma: PrismaService,
  params: { storeId: number; start: number; end: number },
): Promise<FinanceReportCashFlowTotals> {
  const { totals } = await queryCashFlowDirectionTotals(prisma, params);
  return totals;
}

/**
 * 财务报表明细行（只有现金流水）。
 *
 * 导出与页面读的是同一套 select / 排序 / 上限，但 CSV 导出只需要明细，
 * 不需要汇总、上期对比和账款行，因此单独暴露这条查询，避免导出白跑另外 4 条 SQL。
 */
export async function queryFinanceReportCashFlowRows(
  prisma: PrismaService,
  params: {
    storeId: number;
    range: { start: number; end: number; empty: boolean };
  },
  maxPageSize = 5000,
): Promise<FinanceReportCashFlowRow[]> {
  if (params.range.empty) {
    return [];
  }

  return prisma.financeCashFlowRecord.findMany({
    where: buildFinanceReportCashFlowWhere(params),
    select: financeReportCashFlowSelect,
    orderBy: FINANCE_REPORT_ROW_ORDER_BY,
    take: maxPageSize,
  });
}

const FINANCE_REPORT_ROW_ORDER_BY = [
  { date: 'desc' },
  { createdAt: 'desc' },
  { id: 'desc' },
] satisfies Prisma.FinanceCashFlowRecordOrderByWithRelationInput[];

interface FinanceReportRowCursor {
  date: Date;
  createdAt: Date;
  id: number;
}

function buildFinanceReportCashFlowWhere(params: {
  storeId: number;
  range: { start: number; end: number };
}): Prisma.FinanceCashFlowRecordWhereInput {
  return {
    storeId: params.storeId,
    date: {
      gte: new Date(params.range.start),
      lte: new Date(params.range.end),
    },
  };
}

/**
 * 导出分批游标：三级排序键逐级严格比较，保证同 date / 同 createdAt 的行不漏不重。
 * 与表索引 `(storeId, date desc, createdAt desc, id desc)` 同向，翻页不需要额外排序。
 */
function buildFinanceReportRowCursorWhere(
  cursor: FinanceReportRowCursor,
): Prisma.FinanceCashFlowRecordWhereInput {
  return {
    OR: [
      { date: { lt: cursor.date } },
      { date: cursor.date, createdAt: { lt: cursor.createdAt } },
      {
        date: cursor.date,
        createdAt: cursor.createdAt,
        id: { lt: cursor.id },
      },
    ],
  };
}

/**
 * 报表 CSV 导出专用：按主排序键 keyset 分批拉取全部明细行。
 *
 * 原实现单次 `findMany(take: 5000)`，超过上限的数据被静默丢弃——用户以为导出了全量，
 * 实际只是前 5000 行，属于「不报错的数据缺失」。改为分批流式后：
 * - 导出总量不再有硬上限；
 * - 任意时刻内存里只有一批（`FINANCE_REPORT_EXPORT_BATCH_SIZE`），大店年度导出不会打爆堆内存。
 */
export async function* iterateFinanceReportCashFlowRows(
  prisma: PrismaService,
  params: {
    storeId: number;
    range: { start: number; end: number; empty: boolean };
  },
  batchSize = FINANCE_REPORT_EXPORT_BATCH_SIZE,
): AsyncGenerator<FinanceReportCashFlowRow> {
  if (params.range.empty) {
    return;
  }

  const baseWhere = buildFinanceReportCashFlowWhere(params);
  let cursor: FinanceReportRowCursor | null = null;

  for (;;) {
    const batch: FinanceReportCashFlowRow[] =
      await prisma.financeCashFlowRecord.findMany({
        where: cursor
          ? { AND: [baseWhere, buildFinanceReportRowCursorWhere(cursor)] }
          : baseWhere,
        select: financeReportCashFlowSelect,
        orderBy: FINANCE_REPORT_ROW_ORDER_BY,
        take: batchSize,
      });

    for (const row of batch) {
      yield row;
    }

    if (batch.length < batchSize) {
      return;
    }

    const lastRow = batch[batch.length - 1];
    cursor = {
      date: lastRow.date,
      createdAt: lastRow.createdAt,
      id: lastRow.id,
    };
  }
}

/**
 * 未结清账款合计（应收 / 应付各一条 SUM，合并为一次 groupBy）。
 *
 * 口径与 `buildDerivedOpenAccountWhere` 完全一致（`store_id = ? AND remaining > 0`）：
 * 该 WHERE 已经排除等价于 settled 的行（remaining <= 0），因此不需要再判 paid_amount，
 * 与 `buildFinanceReportAccountRows` 里 `status !== settled` 的过滤等价。
 *
 * 为什么必须走 SQL：此前汇总是在「最多 5000 条未结清账款明细」上累加，
 * 未结清超过 5000 条时金额被静默截断。诊断库实测（单店 66,220 条未结清）：
 *   真实应收 19,091,684,500 分 vs 明细累加 1,456,958,000 分 → 低估 92.4%。
 * 与第一轮「流水汇总不得用明细行累加」的修法保持同一原则。
 */
async function queryOpenAccountTotals(
  prisma: PrismaService,
  storeId: number,
): Promise<FinanceReportOpenAccountTotals> {
  const rows = await prisma.financeAccountRecord.groupBy({
    by: ['type'],
    where: buildDerivedOpenAccountWhere({ storeId }),
    _sum: { remaining: true },
  });

  let receivableRemaining = 0;
  let payableRemaining = 0;
  for (const row of rows) {
    const remaining = Number(row._sum.remaining ?? 0);
    if (row.type === 'receivable') {
      receivableRemaining = remaining;
    } else {
      payableRemaining = remaining;
    }
  }

  return { receivableRemaining, payableRemaining };
}

/**
 * 报表账款明细行：只取最近 `FINANCE_REPORT_ACCOUNT_ROW_LIMIT` 条未结清账款。
 *
 * 仅用于渲染表格 / 打印 / 导出，**不得**用于金额汇总（汇总见 queryOpenAccountTotals）。
 * 上限依据：前端 DetailCard 一次性渲染全部行，5000 行既是 Redis 缓存值（实测 1004 KB）
 * 也是 DOM 渲染瓶颈；实测 JSON 体积 100 行 20 KB / 200 行 41 KB / 500 行 101 KB，
 * 200 行在载荷与覆盖面之间是拐点。
 */
async function queryReportAccountRows(
  prisma: PrismaService,
  storeId: number,
): Promise<FinanceReportAccountRow[]> {
  return prisma.financeAccountRecord.findMany({
    where: buildDerivedOpenAccountWhere({ storeId }),
    select: financeReportAccountSelect,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: FINANCE_REPORT_ACCOUNT_ROW_LIMIT,
  });
}

/**
 * 报表概况数据：3 条聚合 SQL（本期收支、上期收支、未结清账款合计）。
 *
 * 与明细行拆开取数，概况才能单独进一个只有 7 个数字的缓存 key——
 * 否则 summary 每次刷新都要把 940 KB 明细行一起重新序列化。
 */
export async function queryFinanceReportSummary(
  prisma: PrismaService,
  params: {
    storeId: number;
    currentRange: { start: number; end: number; empty: boolean };
    previousRange: { start: number; end: number; empty: boolean } | null;
  },
): Promise<FinanceReportSummaryData> {
  const currentTotalsPromise = params.currentRange.empty
    ? Promise.resolve<{ totals: FinanceReportCashFlowTotals; count: number }>({
        totals: [],
        count: 0,
      })
    : queryCashFlowDirectionTotals(prisma, {
        storeId: params.storeId,
        start: params.currentRange.start,
        end: params.currentRange.end,
      });

  const previousCashFlowTotalsPromise =
    !params.previousRange || params.previousRange.empty
      ? Promise.resolve<FinanceReportCashFlowTotals>([])
      : queryCashFlowDirectionTotalsOnly(prisma, {
          storeId: params.storeId,
          start: params.previousRange.start,
          end: params.previousRange.end,
        });

  const [currentTotals, previousCashFlowTotals, openAccountTotals] =
    await Promise.all([
      currentTotalsPromise,
      previousCashFlowTotalsPromise,
      queryOpenAccountTotals(prisma, params.storeId),
    ]);

  return {
    currentCashFlowTotals: currentTotals.totals,
    currentCashFlowCount: currentTotals.count,
    previousCashFlowTotals,
    openAccountTotals,
  };
}

/**
 * 报表明细行（现金流水行 + 未结清账款行），只用于渲染 / 打印 / 导出。
 *
 * 与概况分开取数后进独立缓存 key，可用更短 TTL：新增流水更快出现在表格里，
 * 而概况不必因为明细行变化而重算。
 */
export async function queryFinanceReportRows(
  prisma: PrismaService,
  params: {
    storeId: number;
    currentRange: { start: number; end: number; empty: boolean };
  },
  maxPageSize = 5000,
): Promise<FinanceReportRowsData> {
  const [currentCashFlowRecords, accountRecords] = await Promise.all([
    queryFinanceReportCashFlowRows(
      prisma,
      { storeId: params.storeId, range: params.currentRange },
      maxPageSize,
    ),
    queryReportAccountRows(prisma, params.storeId),
  ]);

  return { currentCashFlowRecords, accountRecords };
}
