// 诊断：门店 42 的活动创建信息
import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const res = await pool.query(
    `SELECT id, name, type, enabled, params, start_at, end_at, created_at, updated_at
     FROM marketing_promotions WHERE store_id = 42 ORDER BY id`,
  );
  for (const r of res.rows) {
    console.log(JSON.stringify(r));
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => pool.end());
