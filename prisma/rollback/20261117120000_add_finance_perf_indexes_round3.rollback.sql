-- 回滚：撤销财务模块第三轮性能索引
-- 只删索引，不动数据，也不改任何字段口径。
-- 代码侧无需回滚：索引只是加速层，缺失时查询自动退化为 Sort / Seq Scan（变慢但不报错）。
-- 线上为低峰执行；需要零锁阻塞时改用 DROP INDEX CONCURRENTLY（需在事务外单独执行）：
--   DROP INDEX CONCURRENTLY IF EXISTS "finance_account_records_counterpart_trgm_idx";
--   DROP INDEX CONCURRENTLY IF EXISTS "finance_account_records_note_trgm_idx";
--   DROP INDEX CONCURRENTLY IF EXISTS "finance_account_records_store_id_created_at_id_idx";
--   DROP INDEX CONCURRENTLY IF EXISTS "finance_reconciliation_records_store_id_date_id_idx";

DROP INDEX IF EXISTS "finance_account_records_counterpart_trgm_idx";
DROP INDEX IF EXISTS "finance_account_records_note_trgm_idx";
DROP INDEX IF EXISTS "finance_account_records_store_id_created_at_id_idx";
DROP INDEX IF EXISTS "finance_reconciliation_records_store_id_date_id_idx";

-- 说明：本次迁移未删除任何既有索引，因此回滚不需要重建旧索引。
