import type { PrismaService } from '../../prisma/prisma.service';
import { getShanghaiMonthStartMs } from '../../shared/shanghai-time.utils';
import { getOverdueAtMs } from './finance-account.query';

/** 未结清口径：remaining > 0，与 domain 层 settled 判定互补 */
const OPEN_ACCOUNT_REMAINING = 0;

/**
 * 账款统计聚合结果（金额单位为数据库分）。
 */
export interface FinanceAccountStatsAggregate {
  /** 未结清应收合计 */
  receivableRemaining: number;
  /** 未结清应付合计 */
  payableRemaining: number;
  overdueCount: number;
  newThisMonthCount: number;
}

interface RawAccountStatsRow {
  receivable_remaining: bigint | number | string | null;
  payable_remaining: bigint | number | string | null;
  overdue_count: number;
  new_this_month_count: number;
}

/**
 * 账款统计走**单条**聚合 SQL，一次扫描算完 4 个指标。
 *
 * 演进路径：全量 `findMany` 逐行派生 → `groupBy + count + count` 三条聚合（并行）
 * → 现在的一条 `FILTER` 聚合。三项指标口径同源（同一扫描、同一 WHERE），
 * 既省掉 2 次往返，也避免三次查询在并发写入时读到不同快照的轻微不一致。
 *
 * 口径与 `buildDerivedFinanceAccountStatusWhere` 严格对齐（漏对齐会漏报逾期）：
 * - 未结清余额：`remaining > 0`，按 type 分组求和；
 * - 逾期笔数：`remaining > 0` 且 `due_date <= now - 1 天`（到期日当天不算逾期）；
 * - 本月新增：`created_at >= 上海当月 1 号零点`，不看是否结清。
 *
 * 时间下界由 `getOverdueAtMs` / `getShanghaiMonthStartMs` 统一给出，
 * 不在 SQL 里写 `NOW()`，保证与其它模块的上海口径完全一致。
 */
export async function queryAccountStatsAggregate(
  prisma: PrismaService,
  params: { storeId: number; now: number },
): Promise<FinanceAccountStatsAggregate> {
  const monthStart = new Date(getShanghaiMonthStartMs(params.now));
  const overdueAt = new Date(getOverdueAtMs(params.now));

  const rows = await prisma.$queryRaw<RawAccountStatsRow[]>`
    SELECT
      COALESCE(
        SUM(remaining) FILTER (
          WHERE type = 'receivable' AND remaining > ${OPEN_ACCOUNT_REMAINING}
        ),
        0
      ) AS "receivable_remaining",
      COALESCE(
        SUM(remaining) FILTER (
          WHERE type = 'payable' AND remaining > ${OPEN_ACCOUNT_REMAINING}
        ),
        0
      ) AS "payable_remaining",
      COUNT(*) FILTER (
        WHERE remaining > ${OPEN_ACCOUNT_REMAINING}
          AND due_date IS NOT NULL
          AND due_date <= ${overdueAt}
      )::int AS "overdue_count",
      COUNT(*) FILTER (WHERE created_at >= ${monthStart})::int AS "new_this_month_count"
    FROM finance_account_records
    WHERE store_id = ${params.storeId}
      AND (remaining > ${OPEN_ACCOUNT_REMAINING} OR created_at >= ${monthStart})
  `;

  const row = rows[0];

  return {
    receivableRemaining: Number(row?.receivable_remaining ?? 0),
    payableRemaining: Number(row?.payable_remaining ?? 0),
    overdueCount: Number(row?.overdue_count ?? 0),
    newThisMonthCount: Number(row?.new_this_month_count ?? 0),
  };
}
