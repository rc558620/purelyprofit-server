/* 回滚：恢复错配前的 (store_id, manual_entry, created_at) 索引 */

DROP INDEX CONCURRENTLY IF EXISTS "sale_orders_store_id_manual_entry_date_idx";

CREATE INDEX CONCURRENTLY IF NOT EXISTS "sale_orders_store_id_manual_entry_created_at_idx"
  ON "sale_orders" ("store_id", "manual_entry", "created_at");
