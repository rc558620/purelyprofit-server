#!/usr/bin/env node
/**
 * 修复 club-recharge-settlement 将充值金额错误计入 totalSpent 的数据污染问题。
 *
 * 背景：club-recharge-settlement.service.ts 的 updateCustomerAfterRecharge
 * 曾在充值落账时将充值金额（含赠送）累加到 totalSpent 并重算 tier，
 * 导致仅充值未消费的顾客也显示有「累计消费」。
 *
 * 修复逻辑：
 *   1. 按 marketing_consumptions 实际消费汇总重算 totalSpent
 *   2. 按修正后的 totalSpent 重算 tier（使用硬编码兜底阈值）
 *   3. 仅更新 totalSpent 与实际消费汇总不一致的行
 *
 * 使用方式：
 *   DATABASE_URL=postgresql://... node scripts/fix-total-spent-from-recharge-pollution.mjs
 *   # 加 --dry-run 只查询不写入
 */

import pg from 'pg';

const DRY_RUN = process.argv.includes('--dry-run');
const TIER_THRESHOLDS = { gold: 200_00, diamond: 1_000_000 }; // 单位：分

function calcTier(totalSpent) {
  if (totalSpent >= TIER_THRESHOLDS.diamond) return 'diamond';
  if (totalSpent >= TIER_THRESHOLDS.gold) return 'gold';
  return 'regular';
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

try {
  // 查出所有 totalSpent 与实际消费汇总不一致的顾客
  const { rows: mismatched } = await client.query(`
    SELECT
      mc.id,
      mc.total_spent AS "currentTotalSpent",
      mc.tier AS "currentTier",
      COALESCE(actual.sum_amount, 0) AS "actualTotalSpent"
    FROM marketing_customers mc
    LEFT JOIN (
      SELECT customer_id, SUM(amount) AS sum_amount
      FROM marketing_consumptions
      GROUP BY customer_id
    ) actual ON actual.customer_id = mc.id
    WHERE mc.total_spent != COALESCE(actual.sum_amount, 0)
      AND mc.deleted_at IS NULL
    ORDER BY mc.id
  `);

  console.log(`发现 ${mismatched.length} 个顾客 totalSpent 与实际消费不一致`);

  if (mismatched.length === 0) {
    console.log('无需修复');
  } else {
    for (const row of mismatched) {
      const actualTotalSpent = Number(row.actualTotalSpent);
      const newTier = calcTier(actualTotalSpent);
      console.log(
        `  顾客 #${row.id}: totalSpent ${row.currentTotalSpent} → ${actualTotalSpent}, ` +
        `tier ${row.currentTier} → ${newTier}`,
      );
    }

    if (DRY_RUN) {
      console.log('\n[dry-run] 未执行写入，去掉 --dry-run 参数以执行修复');
    } else {
      // 批量修复：用子查询按实际消费汇总重算 totalSpent 和 tier
      const result = await client.query(`
        UPDATE marketing_customers mc
        SET
          total_spent = COALESCE(actual.sum_amount, 0),
          tier = CASE
            WHEN COALESCE(actual.sum_amount, 0) >= $1 THEN 'diamond'::"MarketingCustomerTier"
            WHEN COALESCE(actual.sum_amount, 0) >= $2 THEN 'gold'::"MarketingCustomerTier"
            ELSE 'regular'::"MarketingCustomerTier"
          END
        FROM (
          SELECT customer_id, SUM(amount) AS sum_amount
          FROM marketing_consumptions
          GROUP BY customer_id
        ) actual
        WHERE actual.customer_id = mc.id
          AND mc.total_spent != COALESCE(actual.sum_amount, 0)
          AND mc.deleted_at IS NULL
      `, [TIER_THRESHOLDS.diamond, TIER_THRESHOLDS.gold]);

      // 处理没有任何消费记录但 totalSpent != 0 的顾客
      const result2 = await client.query(`
        UPDATE marketing_customers mc
        SET
          total_spent = 0,
          tier = 'regular'::"MarketingCustomerTier"
        WHERE mc.total_spent != 0
          AND mc.deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM marketing_consumptions WHERE customer_id = mc.id
          )
      `);

      console.log(`\n修复完成：有消费记录 ${result.rowCount} 行，无消费记录 ${result2.rowCount} 行`);
    }
  }
} finally {
  await client.end();
}
