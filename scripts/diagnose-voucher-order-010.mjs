// 诊断：团购券订单 VC20260811135913741FADD 的优惠来源
import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  // 1. 找订单（表名可能含 voucher）
  const tables = await pool.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE '%voucher%'`,
  );
  console.log('=== voucher 相关表 ===');
  console.log(tables.rows.map((r) => r.table_name).join('\n'));

  // 2. 查订单记录（尝试几个可能的表）
  for (const t of tables.rows.map((r) => r.table_name)) {
    try {
      const res = await pool.query(
        `SELECT * FROM ${t} WHERE order_no = $1 OR id::text = $1 LIMIT 1`,
        ['VC20260811135913741FADD'],
      );
      if (res.rows.length > 0) {
        console.log(`\n=== ${t} 命中 ===`);
        console.log(JSON.stringify(res.rows[0], null, 2));
      }
    } catch { /* 表结构不同则跳过 */ }
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => pool.end());
