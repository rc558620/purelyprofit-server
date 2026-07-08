#!/usr/bin/env node
/**
 * 诊断脚本：排查积分抵扣后余额未更新问题
 *
 * 针对账号 13312341234，检查：
 *   1. 是否存在消费记录（marketing_consumptions）
 *   2. 是否存在积分流水（marketing_points_records）
 *   3. 当前积分余额（marketing_customers.points）
 *   4. 是否有 Redis 中未结算的 pending 订单草稿
 *
 * 使用方式：
 *   DATABASE_URL=postgresql://... node scripts/diagnose-points-deduction.mjs
 */

import pg from 'pg';

const PHONE = '13312341234';

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

try {
  // 1. 查找该手机号关联的 marketing_customers 记录
  const { rows: customers } = await client.query(
    `SELECT id, store_id, phone, balance, points, tier, total_spent, visit_count, deleted_at
     FROM marketing_customers
     WHERE phone = $1
     ORDER BY id`,
    [PHONE],
  );

  if (customers.length === 0) {
    console.log(`❌ 未找到 phone=${PHONE} 的 marketing_customers 记录`);
    process.exit(1);
  }

  console.log(`\n═══ marketing_customers (${customers.length} 条) ═══`);
  for (const c of customers) {
    console.log(
      `  id=${c.id}  storeId=${c.store_id}  balance=${c.balance}分  points=${c.points}  tier=${c.tier}  totalSpent=${c.total_spent}分  visits=${c.visit_count}  deleted=${c.deleted_at ?? '否'}`,
    );
  }

  const customerIds = customers.map((c) => c.id);

  // 2. 查找最近的消费记录
  const { rows: consumptions } = await client.query(
    `SELECT id, store_id, customer_id, amount, balance_paid, points_deducted, pay_type, items_summary, created_at
     FROM marketing_consumptions
     WHERE customer_id = ANY($1::int[])
     ORDER BY created_at DESC
     LIMIT 10`,
    [customerIds],
  );

  console.log(`\n═══ 最近消费记录 (${consumptions.length} 条) ═══`);
  if (consumptions.length === 0) {
    console.log('  ⚠️  无任何消费记录 → 说明 settle (persistPaidDraft) 从未执行过');
  } else {
    for (const r of consumptions) {
      console.log(
        `  id=${r.id}  customerId=${r.customer_id}  amount=${r.amount}分  balancePaid=${r.balance_paid}分  pointsDeducted=${r.points_deducted}分  payType=${r.pay_type}  items="${r.items_summary}"  time=${r.created_at}`,
      );
    }
  }

  // 3. 查找积分流水
  const { rows: pointsRecords } = await client.query(
    `SELECT id, store_id, customer_id, amount, type, description, created_at
     FROM marketing_points_records
     WHERE customer_id = ANY($1::int[])
     ORDER BY created_at DESC
     LIMIT 20`,
    [customerIds],
  );

  console.log(`\n═══ 积分流水 (${pointsRecords.length} 条) ═══`);
  if (pointsRecords.length === 0) {
    console.log('  ⚠️  无任何积分流水 → deductCustomerPoints 和 awardConsumptionPoints 均未执行');
  } else {
    for (const r of pointsRecords) {
      console.log(
        `  id=${r.id}  customerId=${r.customer_id}  amount=${r.amount}  type=${r.type}  desc="${r.description}"  time=${r.created_at}`,
      );
    }
  }

  // 4. 汇总
  const hasSpendRecord = pointsRecords.some((r) => r.type === 'spend');
  const hasConsumption = consumptions.length > 0;

  console.log('\n═══ 诊断结论 ═══');
  if (!hasConsumption && !hasSpendRecord) {
    console.log('  🔴 settle 从未执行。微信支付回调可能未到达或处理失败。');
    console.log('     请检查：');
    console.log('     1. 服务日志中是否有 "微信支付回调解密成功" 日志');
    console.log('     2. 微信商户后台的回调 URL 是否正确且外网可达');
    console.log('     3. Redis 中是否存在 SV 前缀的 pending 草稿（未过期但无法结算）');
  } else if (hasConsumption && !hasSpendRecord) {
    console.log('  🟡 消费记录存在但无积分扣减流水 → 积分抵扣字段 pointsUsed 可能为 0');
    console.log('     请检查消费记录的 points_deducted 字段是否为 0');
  } else if (hasSpendRecord) {
    console.log('  🟢 积分扣减流水存在 → settle 已执行，积分应该已变化');
    console.log('     请对比当前 points 与流水汇总是否一致');
  }
} finally {
  await client.end();
}
