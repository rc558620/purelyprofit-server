/* ── S8 模块级优化新增索引（3 条）──────────────────────────────
 * 来源：S8-operations / S8-finance / S8-staff 三节的「缺失索引」条。
 * 全部使用 CONCURRENTLY 避免锁表。
 *
 * 1. sale_order_items [storeId, orderId] partial
 *    WHERE product_name NOT IN ('预付抵扣','预付款','续费抵扣')
 *    —— 覆盖 business-analysis 4 条 raw SQL 从 soi 侧过滤的查询路径
 *       （business-analysis.query.ts:169-221），排除预付款/抵扣行缩小扫描集。
 *    aggregateOrderStats（sales-record.query.ts:51）驱动表为 sale_orders，
 *    items 侧 JOIN 走 [orderId, createdAt] 索引，本索引为补充覆盖。
 *
 * 2. finance_account_records [storeId, remaining] partial
 *    WHERE remaining > 0
 *    —— 覆盖派生开户状态查询（finance-account.query.ts:53-95），
 *       代码已改为派生状态（overdue/partial/pending 均含 remaining > 0），
 *       不走 DB status 列，现有 [storeId, status, ...] 索引前导列可用但 status 列浪费。
 *
 * 3. cost_records [storeId, sourceType, payrollId] partial
 *    WHERE payroll_id IS NOT NULL
 *    —— 重建被误 DROP 的 cost_records_store_source_payroll_unique
 *       （20261007100000_sync_local_drift_baseline/migration.sql:62 DROP 后未重建）。
 *       非 unique（唯一性由应用层 upsertPayrollCostRecord 的 findFirst+update/create 保证）。
 *       覆盖 costs-write.service.ts:294-300 findFirst 和
 *       employees-snapshot-sync.service.ts:177-184 raw SQL 查询。
 *
 * 时区假设：本批不涉及时间列索引的时区转换。
 * 回滚：见 migration_rollback.sql
 */

-- 1. sale_order_items [storeId, orderId] partial
CREATE INDEX CONCURRENTLY IF NOT EXISTS "sale_order_items_store_id_order_id_partial_idx"
  ON "sale_order_items" ("store_id", "order_id")
  WHERE "product_name" NOT IN ('预付抵扣', '预付款', '续费抵扣');

-- 2. finance_account_records [storeId, remaining] partial
CREATE INDEX CONCURRENTLY IF NOT EXISTS "finance_account_records_store_id_remaining_open_idx"
  ON "finance_account_records" ("store_id", "remaining")
  WHERE "remaining" > 0;

-- 3. cost_records [storeId, sourceType, payrollId] partial
CREATE INDEX CONCURRENTLY IF NOT EXISTS "cost_records_store_source_payroll_idx"
  ON "cost_records" ("store_id", "source_type", "payroll_id")
  WHERE "payroll_id" IS NOT NULL;
