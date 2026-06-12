import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { toMoneyNumber } from '../finance/finance-money.utils';

interface DailyTrendRow {
  date: Date;
  total: Prisma.Decimal;
}

interface MonthlyTrendRow {
  year: number;
  month: number;
  total: Prisma.Decimal;
}

export async function queryOverviewDailyTrend(
  prisma: PrismaService,
  storeId: number,
): Promise<Array<{ date: Date; amount: number }>> {
  const rows = await prisma.$queryRaw<DailyTrendRow[]>`
    SELECT
      DATE_TRUNC('day', created_at)::date AS "date",
      ROUND(SUM(amount + gift_amount), 2) AS "total"
    FROM marketing_recharges
    WHERE store_id = ${storeId}
      AND type IN ('recharge', 'gift')
      AND created_at >= CURRENT_DATE - INTERVAL '30 days'
    GROUP BY DATE_TRUNC('day', created_at)
    ORDER BY "date" ASC
  `;

  return rows.map((r) => ({
    date: r.date,
    amount: toMoneyNumber(r.total),
  }));
}

export async function queryOverviewMonthlyTrend(
  prisma: PrismaService,
  storeId: number,
  previousYearStart: Date,
): Promise<Array<{ year: number; month: number; amount: number }>> {
  const rows = await prisma.$queryRaw<MonthlyTrendRow[]>`
    SELECT
      EXTRACT(YEAR FROM created_at)::int AS "year",
      (EXTRACT(MONTH FROM created_at) - 1)::int AS "month",
      ROUND(SUM(amount + gift_amount), 2) AS "total"
    FROM marketing_recharges
    WHERE store_id = ${storeId}
      AND created_at >= ${previousYearStart}
      AND type IN ('recharge', 'gift')
    GROUP BY EXTRACT(YEAR FROM created_at), EXTRACT(MONTH FROM created_at)
    ORDER BY "year" ASC, "month" ASC
  `;

  return rows.map((r) => ({
    year: r.year,
    month: r.month,
    amount: toMoneyNumber(r.total),
  }));
}
