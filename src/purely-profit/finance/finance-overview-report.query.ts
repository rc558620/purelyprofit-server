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

export async function queryFinanceReportData(
  prisma: PrismaService,
  params: {
    storeId: number;
    currentRange: { start: number; end: number; empty: boolean };
    previousRange: { start: number; end: number; empty: boolean } | null;
  },
  maxPageSize = 5000,
): Promise<{
  currentCashFlowRecords: Array<
    Pick<
      FinanceCashFlowRecordWithAmount,
      'id' | 'date' | 'title' | 'direction' | 'category' | 'amount' | 'payment'
    >
  >;
  previousCashFlowRecords: Array<
    Pick<FinanceCashFlowStatsRow, 'direction' | 'amount'>
  >;
  accountRecords: FinanceAccountRecordWithAmount[];
}> {
  const currentCashFlowRecordsPromise = params.currentRange.empty
    ? Promise.resolve<
        Array<
          Pick<
            FinanceCashFlowRecordWithAmount,
            | 'id'
            | 'date'
            | 'title'
            | 'direction'
            | 'category'
            | 'amount'
            | 'payment'
          >
        >
      >([])
    : prisma.financeCashFlowRecord.findMany({
        where: {
          storeId: params.storeId,
          date: {
            gte: new Date(params.currentRange.start),
            lte: new Date(params.currentRange.end),
          },
        },
        select: financeReportCashFlowSelect,
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
        take: maxPageSize,
      });

  const previousCashFlowRowsPromise = (async (): Promise<
    Array<Pick<FinanceCashFlowStatsRow, 'direction' | 'amount'>>
  > => {
    if (!params.previousRange || params.previousRange.empty) {
      return [];
    }
    const rows = await prisma.financeCashFlowRecord.groupBy({
      by: ['direction'],
      where: {
        storeId: params.storeId,
        date: {
          gte: new Date(params.previousRange.start),
          lte: new Date(params.previousRange.end),
        },
      },
      _sum: { amount: true },
    });
    return rows.map((row) => ({
      direction: row.direction,
      amount: Number(row._sum.amount ?? 0), // 数据库分，后续统一在 domain 层转元
    }));
  })();

  const accountRecordsPromise = prisma.financeAccountRecord.findMany({
    where: buildDerivedOpenAccountWhere({
      storeId: params.storeId,
      now: params.currentRange.end,
    }),
    select: financeReportAccountSelect,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: maxPageSize,
  });

  const [currentCashFlowRecords, previousCashFlowRows, accountRecords] =
    await Promise.all([
      currentCashFlowRecordsPromise,
      previousCashFlowRowsPromise,
      accountRecordsPromise,
    ]);

  return {
    currentCashFlowRecords,
    previousCashFlowRecords: previousCashFlowRows,
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
