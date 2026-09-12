// 一次性数据修正：marketing_points_records.created_at 时区口径修正（-8h）
//
// 背景：
// 该表时间列是 TIMESTAMP WITHOUT TIME ZONE。历史上部分写入走裸 SQL INSERT 且未显式
// 传 created_at，导致列默认值 CURRENT_TIMESTAMP 取数据库会话时区（Asia/Shanghai）的
// 墙钟；而 Prisma/驱动按 UTC 解释 naive 值，这些行的时间比真实瞬间快 8 小时。
// （同一笔充值：marketing_recharges 走 Prisma create 存 UTC 墙钟，本表走裸 INSERT 存
//   上海墙钟，两者相差正好 8 小时，可互相印证。）
//
// 走裸 SQL 的只有两类流水（可按 description 精确识别）：
//   1. `充值赠送积分（…）`          —— club-recharge-settlement.service.ts
//   2. `消费抵扣积分` / `消费抵扣：…` —— marketing-consumptions.service.ts
// 其余（消费获得积分 / 退款返还积分 / 后台调整积分 等）都走 Prisma create，无需修正。
//
// 用法：
//   node scripts/fix-marketing-points-records-timezone.mjs          # 预览，不落库
//   node scripts/fix-marketing-points-records-timezone.mjs --apply  # 事务内执行修正
//
// ⚠️ 只能执行一次：重复执行会把已修正的行再减 8 小时。
// 仅需在「数据库会话时区为 UTC+8」的环境执行一次；生产环境执行前请先用预览模式核对。
import 'dotenv/config';
import pg from 'pg';

const { Client } = pg;

const APPLY = process.argv.includes('--apply');
// 与代码中的裸 INSERT 描述保持一致（见上方说明）
const AFFECTED_WHERE = `
  (description LIKE '充值赠送积分%'
   OR description = '消费抵扣积分'
   OR description LIKE '消费抵扣：%')
`;

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const preview = await client.query(
    `SELECT id, description, amount,
            created_at AT TIME ZONE 'UTC' AS prisma_read_before,
            (created_at - INTERVAL '8 hours') AT TIME ZONE 'UTC' AS prisma_read_after
       FROM marketing_points_records
      WHERE ${AFFECTED_WHERE}
      ORDER BY id DESC LIMIT 10`,
  );
  const count = await client.query(
    `SELECT count(*)::int AS total FROM marketing_points_records WHERE ${AFFECTED_WHERE}`,
  );

  console.log(`待修正行数: ${count.rows[0].total}`);
  console.table(
    preview.rows.map((row) => ({
      id: row.id,
      description: row.description,
      amount: row.amount,
      Prisma当前读到_错: row.prisma_read_before,
      Prisma修正后读到_对: row.prisma_read_after,
    })),
  );

  if (!APPLY) {
    console.log('预览模式（加 --apply 执行修正；⚠️ --apply 只能执行一次）');
    await client.end();
    return;
  }

  await client.query('BEGIN');
  const updated = await client.query(
    `UPDATE marketing_points_records
        SET created_at = created_at - INTERVAL '8 hours'
      WHERE ${AFFECTED_WHERE}`,
  );
  await client.query('COMMIT');
  console.log(`已修正 ${updated.rowCount} 行`);

  await client.end();
}

main().catch((error) => {
  console.error(String(error).slice(0, 500));
  process.exit(1);
});
