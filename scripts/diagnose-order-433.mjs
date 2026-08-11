// 诊断：订单 433 的营销快照明细（前端优惠清单数据源）
import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const res = await pool.query(
    `SELECT id, item_original_amount, specification_extra_amount, payable_amount, marketing_snapshot
     FROM scan_orders WHERE id = 433`,
  );
  const r = res.rows[0];
  const snap = typeof r.marketing_snapshot === 'string' ? JSON.parse(r.marketing_snapshot) : r.marketing_snapshot;
  console.log('=== marketingSnapshot ===');
  console.log(JSON.stringify(snap, null, 2));
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => pool.end());
