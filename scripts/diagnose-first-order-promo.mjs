// 诊断：新账号 13619654012 首单优惠未生效原因排查
// 1) 用户身份与营销客户  2) 门店首单活动配置  3) 消费记录数（首单判定）
import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const PHONE = '13619654012';

async function main() {
  // 1. 查找 club 用户
  const userRes = await pool.query(
    `SELECT id, email, name, created_at FROM users WHERE email = $1 LIMIT 1`,
    [`club_phone_${PHONE}@purelyprofit.local`],
  );
  if (userRes.rows.length === 0) {
    console.log(`❌ 未找到用户 email=club_phone_${PHONE}@purelyprofit.local`);
    return;
  }
  const user = userRes.rows[0];
  console.log(`=== 用户 ===`);
  console.log(JSON.stringify(user));

  // 2. 营销客户（按门店）
  const customerRes = await pool.query(
    `SELECT id, store_id, phone, balance, points, tier, visit_count, total_spent, created_at
     FROM marketing_customers WHERE phone = $1 AND deleted_at IS NULL ORDER BY id`,
    [PHONE],
  );
  console.log(`\n=== 营销客户（marketing_customers）===`);
  if (customerRes.rows.length === 0) {
    console.log('❌ 无营销客户记录');
  } else {
    for (const c of customerRes.rows) {
      console.log(JSON.stringify(c));
      // 消费记录数（首单判定依据）
      const countRes = await pool.query(
        `SELECT COUNT(*)::int AS cnt FROM marketing_consumptions WHERE store_id = $1 AND customer_id = $2`,
        [c.store_id, c.id],
      );
      console.log(`  └─ 消费记录数: ${countRes.rows[0].cnt}`);

      // 3. 该门店的营销活动
      const promoRes = await pool.query(
        `SELECT id, name, type, enabled, params, start_at, end_at, created_at
         FROM marketing_promotions
         WHERE store_id = $1 AND type IN ('first_order_discount','discount','discount_day','reduce')
         ORDER BY id DESC`,
        [c.store_id],
      );
      console.log(`\n=== 门店 ${c.store_id} 的营销活动 ===`);
      if (promoRes.rows.length === 0) {
        console.log('❌ 无任何活动');
      }
      for (const p of promoRes.rows) {
        const now = new Date();
        const active = p.enabled && new Date(p.start_at) <= now && new Date(p.end_at) >= now;
        console.log(
          `${active ? '✅生效' : '⚠️未生效'} type=${p.type} id=${p.id} name=${p.name} enabled=${p.enabled} start=${p.start_at} end=${p.end_at} params=${JSON.stringify(p.params)}`,
        );
      }
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
