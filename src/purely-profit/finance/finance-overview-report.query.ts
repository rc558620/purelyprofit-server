import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
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
  const [currentCashFlowRecords, previousCashFlowRows, accountRecords] =
    await Promise.all([
      params.currentRange.empty
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
          }),
      params.previousRange && !params.previousRange.empty
        ? prisma.financeCashFlowRecord
            .groupBy({
              by: ['direction'],
              where: {
                storeId: params.storeId,
                date: {
                  gte: new Date(params.previousRange.start),
                  lte: new Date(params.previousRange.end),
                },
              },
              _sum: { amount: true },
            })
            .then((rows) =>
              rows.map((row) => ({
                direction: row.direction,
                amount: row._sum.amount ?? new Prisma.Decimal(0),
              })),
            )
        : Promise.resolve<Array<Pick<FinanceCashFlowStatsRow, 'direction' | 'amount'>>>([]),
      prisma.financeAccountRecord.findMany({
        where: buildDerivedOpenAccountWhere({
          storeId: params.storeId,
          now: params.currentRange.end,
        }),
        select: financeReportAccountSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    ]);

  return {
    currentCashFlowRecords,
    previousCashFlowRecords: previousCashFlowRows,
    accountRecords,
  };
}

interface OverviewCategoryTotalRow {
  category: string;
  total: Prisma.Decimal;
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

  const rows = await prisma.$queryRaw<OverviewCategoryTotalRow[]>`
    SELECT
      category,
      ROUND(SUM(amount), 2) AS "total"
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
        ROUND(SUM(amount), 2) AS "total"
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
      amount: Number(r.total),
    })),
    previous: prevRows.map((r) => ({
      category: r.category,
      amount: Number(r.total),
    })),
  };
}

interface OverviewDailyTrendRow {
  day: Date;
  income_total: Prisma.Decimal;
  expense_total: Prisma.Decimal;
}

export async function queryOverviewDailyTrend(
  prisma: PrismaService,
  params: {
    storeId: number;
    start: number;
    end: number;
  },
): Promise<Array<{ day: number; income: number; expense: number }>> {
  const rows = await prisma.$queryRaw<OverviewDailyTrendRow[]>`
    SELECT
      DATE_TRUNC('day', date)::date AS "day",
      ROUND(SUM(amount) FILTER (WHERE direction = 'income'), 2) AS "income_total",
      ROUND(SUM(amount) FILTER (WHERE direction = 'expense'), 2) AS "expense_total"
    FROM finance_cash_flow_records
    WHERE store_id = ${params.storeId}
      AND date >= ${new Date(params.start)}
      AND date <= ${new Date(params.end)}
    GROUP BY DATE_TRUNC('day', date)
    ORDER BY "day" ASC
  `;

  return rows.map((r) => ({
    day: r.day.getTime(),
    income: Number(r.income_total ?? 0),
    expense: Number(r.expense_total ?? 0),
  }));
}
