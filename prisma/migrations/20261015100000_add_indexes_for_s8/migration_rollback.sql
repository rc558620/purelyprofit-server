/* 回滚：删除 3 条新增索引
 * 全部 CONCURRENTLY 无锁表，执行顺序与正向迁移相反 */

-- 3. cost_records [storeId, sourceType, payrollId] partial
DROP INDEX CONCURRENTLY IF EXISTS "cost_records_store_source_payroll_idx";

-- 2. finance_account_records [storeId, remaining] partial
DROP INDEX CONCURRENTLY IF EXISTS "finance_account_records_store_id_remaining_open_idx";

-- 1. sale_order_items [storeId, orderId] partial
DROP INDEX CONCURRENTLY IF EXISTS "sale_order_items_store_id_order_id_partial_idx";
