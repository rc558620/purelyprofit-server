import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ClubLedgerBalanceWindow } from './club-records.types';

/**
 * 储值账户余额快照窗口（DB 侧聚合）。
 *
 * 背景：改前由 Node 把「本页最旧一条之后」的全部流水拉回（两次无 take 的 findMany，
 * 还顺带选了不参与计算的 itemsSummary），再在内存里排序求和。该窗口随会员历史流水
 * 线性增长，深分页时无上界。
 *
 * 现在的做法：一条 SQL 把小票窗口在 DB 内展开成统一账本，用窗口函数求
 * 「截至本条（含）的影响累计」与「窗口合计」，只回传本页 ≤limit 条标量。
 *
 * 口径复刻（与 club-record-query.service.ts 的 mapRechargeRow / mapConsumptionRow 一一对应）：
 * - recharge：余额影响 = total_amount（本金 + 赠送，写入时已固化）
 * - gift：余额影响 = gift_amount > 0 ? gift_amount : amount（历史脏数据兼容），且 <= 0 整行剔除
 * - refund：余额影响 = -total_amount（本金 + 赠送一并收回）
 * - consume：余额影响 = -balance_paid，且只统计 balance_paid > 0
 * - 定序：created_at ASC, kind_rank ASC, numeric_id ASC —— 与展示排序
 *   (created_at DESC, kind_rank DESC, numeric_id DESC) 严格互逆；同刻记录靠 id 补齐次序
 *
 * 安全边界：store_id + customer_id 双等值限定，不跨门店、不跨顾客。
 * 索引支撑：marketing_consumptions (store_id, customer_id, created_at)、
 *           marketing_recharges (store_id, customer_id, created_at)（本批新增）。
 */
export interface LedgerBalanceWindowParams {
  storeId: number;
  customerId: number;
  /** 窗口起点（含）：本页最旧一条流水的 createdAt */
  since: Date;
  /** 本页展示流水的复合 ID；只回传这些条目的聚合值 */
  entryIds: string[];
}

interface LedgerBalanceWindowRow {
  id: string;
  cumulativeEffectFen: bigint;
  totalEffectFen: bigint;
}

/** 查询余额快照窗口；无展示条目时返回 null（避免空窗口的多余往返） */
export async function queryLedgerBalanceWindow(
  prisma: PrismaService,
  params: LedgerBalanceWindowParams,
): Promise<ClubLedgerBalanceWindow | null> {
  const { storeId, customerId, since, entryIds } = params;
  if (entryIds.length === 0) {
    return null;
  }

  const rows = await prisma.$queryRaw<LedgerBalanceWindowRow[]>`
    WITH recharge_ledger AS (
      SELECT
        r.id,
        r.created_at,
        r.type,
        CASE r.type
          WHEN 'refund' THEN -r.total_amount
          WHEN 'gift' THEN (CASE WHEN r.gift_amount > 0 THEN r.gift_amount ELSE r.amount END)
          ELSE r.total_amount
        END AS effect_fen
      FROM marketing_recharges r
      WHERE r.store_id = ${storeId}
        AND r.customer_id = ${customerId}
        AND r.created_at >= ${since}
    ),
    ledger AS (
      SELECT
        CASE l.type
          WHEN 'refund' THEN 'refund-'
          WHEN 'gift' THEN 'bonus-'
          ELSE 'recharge-'
        END || l.id::text AS entry_id,
        l.created_at AS created_at,
        CASE l.type WHEN 'refund' THEN 4 WHEN 'gift' THEN 1 ELSE 3 END AS kind_rank,
        l.id AS numeric_id,
        l.effect_fen AS effect_fen
      FROM recharge_ledger l
      WHERE NOT (l.type = 'gift' AND l.effect_fen <= 0)
      UNION ALL
      SELECT
        'consume-' || c.id::text,
        c.created_at,
        2,
        c.id,
        -c.balance_paid
      FROM marketing_consumptions c
      WHERE c.store_id = ${storeId}
        AND c.customer_id = ${customerId}
        AND c.created_at >= ${since}
        AND c.balance_paid > 0
    ),
    ranked AS (
      SELECT
        entry_id,
        SUM(effect_fen) OVER w AS cumulative_effect_fen,
        SUM(effect_fen) OVER () AS total_effect_fen
      FROM ledger
      WINDOW w AS (
        ORDER BY created_at ASC, kind_rank ASC, numeric_id ASC
        ROWS UNBOUNDED PRECEDING
      )
    )
    SELECT
      entry_id AS "id",
      cumulative_effect_fen AS "cumulativeEffectFen",
      total_effect_fen AS "totalEffectFen"
    FROM ranked
    WHERE entry_id IN (${Prisma.join(entryIds)})
  `;

  if (rows.length === 0) {
    return null;
  }

  const cumulativeEffectFenById: Record<string, number> = {};
  for (const row of rows) {
    cumulativeEffectFenById[row.id] = Number(row.cumulativeEffectFen);
  }

  return {
    // 窗口合计对每条返回行相同，取首行即可
    totalEffectFen: Number(rows[0].totalEffectFen),
    cumulativeEffectFenById,
  };
}
