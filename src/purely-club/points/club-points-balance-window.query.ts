import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ClubPointsBalanceWindow } from './club-points-snapshot.util';

/**
 * 积分余额快照窗口（DB 侧聚合）。
 *
 * 背景：改前把「不早于本页最旧一条」的全部积分流水拉回 Node 再排序求和（无 take），
 * 该窗口随会员积分流水线性增长，深分页时无上界。
 *
 * 现在的做法：一条 SQL 用窗口函数求「截至本条（含）的变动累计」与「窗口合计」，
 * 只回传本页 ≤limit 条标量。
 *
 * 定序：created_at ASC, id ASC —— 与展示排序（created_at DESC, id DESC）严格互逆；
 * 同一事务写入的记录 createdAt 相同，只能靠 id 补齐次序。
 * 索引支撑：idx_points_records_store_customer_created (store_id, customer_id, created_at DESC, id DESC)
 * 可反向扫描满足升序。
 *
 * 安全边界：store_id + customer_id 双等值限定，不跨门店、不跨顾客。
 */
export interface PointsBalanceWindowParams {
  storeId: number;
  customerId: number;
  /** 窗口起点（含）：本页最旧一条积分记录的 createdAt */
  since: Date;
  /** 本页展示记录的 ID；只回传这些记录的聚合值 */
  recordIds: number[];
}

interface PointsBalanceWindowRow {
  recordId: number;
  cumulativeEffect: bigint;
  totalEffect: bigint;
}

/** 查询积分余额快照窗口；无展示记录时返回 null（避免空窗口的多余往返） */
export async function queryPointsBalanceWindow(
  prisma: PrismaService,
  params: PointsBalanceWindowParams,
): Promise<ClubPointsBalanceWindow | null> {
  const { storeId, customerId, since, recordIds } = params;
  if (recordIds.length === 0) {
    return null;
  }

  const rows = await prisma.$queryRaw<PointsBalanceWindowRow[]>`
    WITH ranked AS (
      SELECT
        p.id AS record_id,
        SUM(p.amount) OVER w AS cumulative_effect,
        SUM(p.amount) OVER () AS total_effect
      FROM marketing_points_records p
      WHERE p.store_id = ${storeId}
        AND p.customer_id = ${customerId}
        AND p.created_at >= ${since}
      WINDOW w AS (
        ORDER BY p.created_at ASC, p.id ASC
        ROWS UNBOUNDED PRECEDING
      )
    )
    SELECT
      record_id AS "recordId",
      cumulative_effect AS "cumulativeEffect",
      total_effect AS "totalEffect"
    FROM ranked
    WHERE record_id IN (${Prisma.join(recordIds)})
  `;

  if (rows.length === 0) {
    return null;
  }

  const cumulativeEffectByRecordId = new Map<number, number>();
  for (const row of rows) {
    cumulativeEffectByRecordId.set(row.recordId, Number(row.cumulativeEffect));
  }

  return {
    // 窗口合计对每条返回行相同，取首行即可
    totalEffect: Number(rows[0].totalEffect),
    cumulativeEffectByRecordId,
  };
}
