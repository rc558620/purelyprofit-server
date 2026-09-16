import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { Money } from '../../shared/money.utils';
import { buildDerivedOpenAccountWhere } from './finance-account.query';
import type {
  FinanceAccountRecordWithAmount,
  FinanceCashFlowRecordWithAmount,
  FinanceCashFlowStatsRow,
} from './finance.types';

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

const financeReportAccountSelect = {
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

export async function queryOverviewCashFlowRecords(
  prisma: PrismaService,
  params: {
    storeId: number;
    start: number;
    end: number;
  },
  maxPageSize = 5000,
): Promise<Array<{ category: string; amount: number; date: Date }>> {
  // Step 3: Int（分）
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
    take: maxPageSize,
  });
}

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

export interface FinanceReportQueryResult {
  /** 仅用于渲染明细行，受 maxPageSize 上限约束，不得用于汇总 */
  currentCashFlowRecords: FinanceReportCashFlowRow[];
  /** 本期收支汇总，SQL 聚合，不受明细分页上限影响 */
  currentCashFlowTotals: FinanceReportCashFlowTotals;
  /** 本期真实流水条数，SQL COUNT，不受明细分页上限影响 */
  currentCashFlowCount: number;
  /** 上期收支汇总，SQL 聚合 */
  previousCashFlowTotals: FinanceReportCashFlowTotals;
  accountRecords: FinanceAccountRecordWithAmount[];
}

/**
 * 按方向聚合区间内流水金额（SQL SUM）。
 * 汇总必须走 SQL 聚合，不能用明细行在内存里累加 —— 明细行有 maxPageSize 上限，
 * 超限时会导致本期金额被低估、与不受限的上期 SUM 对比后环比严重失真。
 */
async function queryCashFlowDirectionTotals(
  prisma: PrismaService,
  params: { storeId: number; start: number; end: number },
): Promise<FinanceReportCashFlowTotals> {
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
  });

  return rows.map((row) => ({
    direction: row.direction,
    amount: Number(row._sum.amount ?? 0), // 数据库分，后续统一在 domain 层转元
  }));
}

export async function queryFinanceReportData(
  prisma: PrismaService,
  params: {
    storeId: number;
    currentRange: { start: number; end: number; empty: boolean };
    previousRange: { start: number; end: number; empty: boolean } | null;
  },
  maxPageSize = 5000,
): Promise<FinanceReportQueryResult> {
  const currentEmpty = params.currentRange.empty;
  const currentRangeWhere = {
    storeId: params.storeId,
    date: {
      gte: new Date(params.currentRange.start),
      lte: new Date(params.currentRange.end),
    },
  };

  const currentCashFlowRecordsPromise = currentEmpty
    ? Promise.resolve<FinanceReportCashFlowRow[]>([])
    : prisma.financeCashFlowRecord.findMany({
        where: currentRangeWhere,
        select: financeReportCashFlowSelect,
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
        take: maxPageSize,
      });

  const currentCashFlowTotalsPromise = currentEmpty
    ? Promise.resolve<FinanceReportCashFlowTotals>([])
    : queryCashFlowDirectionTotals(prisma, {
        storeId: params.storeId,
        start: params.currentRange.start,
        end: params.currentRange.end,
      });

  const currentCashFlowCountPromise = currentEmpty
    ? Promise.resolve(0)
    : prisma.financeCashFlowRecord.count({ where: currentRangeWhere });

  const previousCashFlowTotalsPromise =
    !params.previousRange || params.previousRange.empty
      ? Promise.resolve<FinanceReportCashFlowTotals>([])
      : queryCashFlowDirectionTotals(prisma, {
          storeId: params.storeId,
          start: params.previousRange.start,
          end: params.previousRange.end,
        });

  const accountRecordsPromise = prisma.financeAccountRecord.findMany({
    where: buildDerivedOpenAccountWhere({
      storeId: params.storeId,
    }),
    select: financeReportAccountSelect,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: maxPageSize,
  });

  const [
    currentCashFlowRecords,
    currentCashFlowTotals,
    currentCashFlowCount,
    previousCashFlowTotals,
    accountRecords,
  ] = await Promise.all([
    currentCashFlowRecordsPromise,
    currentCashFlowTotalsPromise,
    currentCashFlowCountPromise,
    previousCashFlowTotalsPromise,
    accountRecordsPromise,
  ]);

  return {
    currentCashFlowRecords,
    currentCashFlowTotals,
    currentCashFlowCount,
    previousCashFlowTotals,
    accountRecords,
  };
}

interface OverviewCategoryTotalRow {
  category: string;
  total: bigint | number; // $queryRaw 返回 SUM 为 bigint（PostgreSQL）
}

export async function queryOverviewCategoryTotals(
  prisma: PrismaService,
  params: {
    storeId: number;
    currentStart: number;
    currentEnd: number;
    prevStart: number | null;
    prevEnd: number | null;
  },
): Promise<{
  current: Array<{ category: string; amount: number }>;
  previous: Array<{ category: string; amount: number }>;
}> {
  const hasPrev = params.prevStart !== null && params.prevEnd !== null;
  const prevStart = hasPrev
    ? new Date(params.prevStart!)
    : new Date(params.currentStart);
  const prevEnd = hasPrev
    ? new Date(params.prevEnd!)
    : new Date(params.currentStart);

  // 金额在数据库中存为分（Int），SQL 直接 SUM 整数，避免 ROUND 引入浮点误差
  const rows = await prisma.$queryRaw<OverviewCategoryTotalRow[]>`
    SELECT
      category,
      SUM(amount) AS "total"
    FROM finance_cash_flow_records
    WHERE store_id = ${params.storeId}
      AND date >= ${new Date(params.currentStart)}
      AND date <= ${new Date(params.currentEnd)}
    GROUP BY category
  `;

  let prevRows: OverviewCategoryTotalRow[] = [];
  if (hasPrev) {
    prevRows = await prisma.$queryRaw<OverviewCategoryTotalRow[]>`
      SELECT
        category,
        SUM(amount) AS "total"
      FROM finance_cash_flow_records
      WHERE store_id = ${params.storeId}
        AND date >= ${prevStart}
        AND date <= ${prevEnd}
      GROUP BY category
    `;
  }

  return {
    current: rows.map((r) => ({
      category: r.category,
      amount: Money.fromDbCents(Number(r.total)).toDbCents(),
    })),
    previous: prevRows.map((r) => ({
      category: r.category,
      amount: Money.fromDbCents(Number(r.total)).toDbCents(),
    })),
  };
}

interface OverviewDailyTrendRow {
  day: Date;
  income_total: bigint | number | null; // $queryRaw 返回 SUM 为 bigint（PostgreSQL）
  expense_total: bigint | number | null;
}

export async function queryOverviewDailyTrend(
  prisma: PrismaService,
  params: {
    storeId: number;
    start: number;
    end: number;
  },
): Promise<Array<{ day: number; income: number; expense: number }>> {
  // 金额在数据库中存为分（Int），SQL 直接 SUM 整数，避免 ROUND 引入浮点误差
  // + interval '8 hours' 将 UTC 时间戳转为上海本地日再截断，与 JS getShanghaiDayStartMs 对齐
  const rows = await prisma.$queryRaw<OverviewDailyTrendRow[]>`
    SELECT
      date_trunc('day', date + interval '8 hours') - interval '8 hours' AS "day",
      SUM(amount) FILTER (WHERE direction = 'income') AS "income_total",
      SUM(amount) FILTER (WHERE direction = 'expense') AS "expense_total"
    FROM finance_cash_flow_records
    WHERE store_id = ${params.storeId}
      AND date >= ${new Date(params.start)}
      AND date <= ${new Date(params.end)}
    GROUP BY 1
    ORDER BY 1 ASC
  `;

  return rows.map((r) => ({
    day: r.day.getTime(),
    income: Money.fromDbCents(Number(r.income_total ?? 0)).toDbCents(),
    expense: Money.fromDbCents(Number(r.expense_total ?? 0)).toDbCents(),
  }));
}

// ─── 年度月聚合趋势查询 ───────────────────────────────────────────

interface OverviewMonthlyTrendRow {
  month: Date;
  income_total: bigint | number | null;
  expense_total: bigint | number | null;
}

/** 按月聚合趋势数据，用于 year 周期，避免前端对浮点金额做 += 累加 */
export async function queryOverviewMonthlyTrend(
  prisma: PrismaService,
  params: {
    storeId: number;
    start: number;
    end: number;
  },
): Promise<Array<{ month: number; income: number; expense: number }>> {
  // 金额在数据库中存为分（Int），SQL 直接 SUM 整数，避免 ROUND 引入浮点误差
  // + interval '8 hours' 将 UTC 时间戳转为上海本地月再截断，与 JS getShanghaiMonthStartMs 对齐
  const rows = await prisma.$queryRaw<OverviewMonthlyTrendRow[]>`
    SELECT
      date_trunc('month', date + interval '8 hours') - interval '8 hours' AS "month",
      SUM(amount) FILTER (WHERE direction = 'income') AS "income_total",
      SUM(amount) FILTER (WHERE direction = 'expense') AS "expense_total"
    FROM finance_cash_flow_records
    WHERE store_id = ${params.storeId}
      AND date >= ${new Date(params.start)}
      AND date <= ${new Date(params.end)}
    GROUP BY 1
    ORDER BY 1 ASC
  `;

  return rows.map((r) => ({
    month: r.month.getTime(),
    income: Money.fromDbCents(Number(r.income_total ?? 0)).toDbCents(),
    expense: Money.fromDbCents(Number(r.expense_total ?? 0)).toDbCents(),
  }));
}
