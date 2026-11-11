/* 回滚 20261111100000_remove_products_updated_at_from_indexes
 * 先恢复原索引，再删除新索引，保证任何阶段都有索引覆盖过滤条件。
 * 有存量数据的环境需改为 CONCURRENTLY 并在事务外分步执行。
 */

CREATE INDEX IF NOT EXISTS "products_store_id_category_updated_at_idx"
  ON "products" ("store_id", "category", "updated_at") WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "products_store_id_is_active_updated_at_idx"
  ON "products" ("store_id", "is_active", "updated_at") WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "products_category_id_updated_at_idx"
  ON "products" ("category_id", "updated_at");

DROP INDEX IF EXISTS "products_store_id_category_idx";
DROP INDEX IF EXISTS "products_store_id_is_active_idx";
DROP INDEX IF EXISTS "products_category_id_idx";
