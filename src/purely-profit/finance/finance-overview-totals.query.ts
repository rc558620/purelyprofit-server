import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';

/**
 * 概览页聚合查询（类目合计 / 趋势）。
 *
 * 与报表查询（`finance-overview-report.query.ts`）拆开：一个服务概览首屏，
 * 一个服务报表与导出，两边的读模型、聚合粒度和缓存域都不同，混在同一文件
 * 会让「只想改报表」时不得不在概览 SQL 里来回跳。
 */

interface OverviewCategoryTotalRow {
  category: string;
  current_total: bigint | number | null; // $queryRaw 返回 SUM 为 bigint（PostgreSQL）
  previous_total: bigint | number | null;
}

/**
 * 概览类目合计：本期与上期在**同一条 SQL** 内聚合。
 *
 * 原先本期、上期各发一条 `GROUP BY category`，两次并行但仍是两条语句、
 * 两个执行计划；合并后只有一次索引扫描（区间相邻时等价于一次连续扫描），
 * 用 `FILTER` 分流到本期/上期列，往返数量减半。
 *
 * 金额在数据库中存为分（Int），SQL 直接 SUM 整数，避免 ROUND 引入浮点误差；
 * 某区间没有任何数据时该列返回 NULL，这里按行过滤，与「分组后不存在该行」等价。
 */
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
  const currentStart = new Date(params.currentStart);
  const currentEnd = new Date(params.currentEnd);
  const previousStart = hasPrev
    ? new Date(params.prevStart as number)
    : currentStart;
  const previousEnd = hasPrev ? new Date(params.prevEnd as number) : currentEnd;

  const rows = await prisma.$queryRaw<OverviewCategoryTotalRow[]>(Prisma.sql`
    SELECT
      category,
      SUM(amount) FILTER (WHERE date >= ${currentStart} AND date <= ${currentEnd}) AS "current_total",
      ${
        hasPrev
          ? Prisma.sql`SUM(amount) FILTER (WHERE date >= ${previousStart} AND date <= ${previousEnd})`
          : Prisma.sql`NULL::bigint`
      } AS "previous_total"
    FROM finance_cash_flow_records
    WHERE store_id = ${params.storeId}
      AND ${
        hasPrev
          ? Prisma.sql`((date >= ${currentStart} AND date <= ${currentEnd}) OR (date >= ${previousStart} AND date <= ${previousEnd}))`
          : Prisma.sql`(date >= ${currentStart} AND date <= ${currentEnd})`
      }
    GROUP BY category
  `);

  return {
    current: rows
      .filter((row) => row.current_total !== null)
      .map((row) => ({
        category: row.category,
        amount: Number(row.current_total),
      })),
    previous: rows
      .filter((row) => row.previous_total !== null)
      .map((row) => ({
        category: row.category,
        amount: Number(row.previous_total),
      })),
  };
}

interface OverviewTrendRow {
  period_start: Date;
  income_total: bigint | number | null; // $queryRaw 返回 SUM 为 bigint（PostgreSQL）
  expense_total: bigint | number | null;
}

/**
 * 趋势点：`periodStart` 为 SQL 直接算好的时间桶起点（UTC 毫秒）。
 *
 * 时间桶边界一律以 SQL 的 `date_trunc` 为准，调用方不得再用 JS 重算一次，
 * 否则两套时区换算一旦偏离，趋势点会静默错位而不报错。
 */
export interface OverviewTrendPoint {
  periodStart: number;
  income: number;
  expense: number;
}

/**
 * 概览趋势聚合（日 / 月共用一条 SQL）。
 *
 * - 金额在数据库中存为分（Int），SQL 直接 SUM 整数，避免 ROUND 引入浮点误差；
 * - `+ interval '8 hours'` 把 UTC 时间戳转成上海本地墙钟再截断，`- interval '8 hours'`
 *   把桶起点还原成 UTC 瞬间，与前端按时间戳分桶完全一致；
 * - year 周期走按月聚合，避免前端对浮点金额做 += 累加。
 */
async function queryOverviewTrend(
  prisma: PrismaService,
  params: { storeId: number; start: number; end: number },
  unit: 'day' | 'month',
): Promise<OverviewTrendPoint[]> {
  const rows = await prisma.$queryRaw<OverviewTrendRow[]>`
    SELECT
      date_trunc(${unit}, date + interval '8 hours') - interval '8 hours' AS "period_start",
      SUM(amount) FILTER (WHERE direction = 'income') AS "income_total",
      SUM(amount) FILTER (WHERE direction = 'expense') AS "expense_total"
    FROM finance_cash_flow_records
    WHERE store_id = ${params.storeId}
      AND date >= ${new Date(params.start)}
      AND date <= ${new Date(params.end)}
    GROUP BY 1
    ORDER BY 1 ASC
  `;

  // SUM 结果已是数据库分，直接透传；调用方统一在 domain 层做分 → 元换算
  return rows.map((r) => ({
    periodStart: r.period_start.getTime(),
    income: Number(r.income_total ?? 0),
    expense: Number(r.expense_total ?? 0),
  }));
}

/** 按日聚合趋势数据（today / week / month / quarter 周期） */
export function queryOverviewDailyTrend(
  prisma: PrismaService,
  params: { storeId: number; start: number; end: number },
): Promise<OverviewTrendPoint[]> {
  return queryOverviewTrend(prisma, params, 'day');
}

/** 按月聚合趋势数据（year 周期） */
export function queryOverviewMonthlyTrend(
  prisma: PrismaService,
  params: { storeId: number; start: number; end: number },
): Promise<OverviewTrendPoint[]> {
  return queryOverviewTrend(prisma, params, 'month');
}
