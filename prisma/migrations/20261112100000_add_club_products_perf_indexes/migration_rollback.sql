/* 回滚 20261112100000_add_club_products_perf_indexes。
 * 生产环境建议把 DROP / CREATE 改为 CONCURRENTLY 并在事务外单独执行。
 */

DROP INDEX IF EXISTS "marketing_products_name_trgm_idx";
DROP INDEX IF EXISTS "marketing_products_store_id_is_active_category_id_id_idx";
DROP INDEX IF EXISTS "marketing_products_store_id_is_active_id_idx";

CREATE INDEX IF NOT EXISTS "marketing_products_store_id_name_idx"
  ON "marketing_products"("store_id", "name");
