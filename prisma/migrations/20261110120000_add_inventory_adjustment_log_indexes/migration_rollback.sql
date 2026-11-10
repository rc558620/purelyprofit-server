/* 回滚 20261110120000_add_inventory_adjustment_log_indexes
 * 先恢复原排序索引，再删除新增索引，保证任何阶段都有索引覆盖列表查询。
 */

CREATE INDEX IF NOT EXISTS "inventory_adjustment_logs_store_id_created_at_idx"
  ON "inventory_adjustment_logs" ("store_id", "created_at");

DROP INDEX IF EXISTS "idx_inventory_adjustment_logs_product_name_trgm";
DROP INDEX IF EXISTS "idx_inventory_adjustment_logs_store_created_id_desc";
