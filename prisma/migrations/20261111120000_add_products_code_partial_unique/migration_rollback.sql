/* 回滚：恢复普通 partial index，移除商品编号唯一约束
 * 先建普通索引再删唯一索引，避免回滚过程中出现无索引窗口。
 * 全部 CONCURRENTLY 无锁表（需在事务外单独执行）。
 *
 * SQL 回滚后还须把 catalog.prisma 的 @@unique 改回 @@index，
 * 否则后续 migrate dev / drift 检查会把唯一索引重新建回来。
 */

CREATE INDEX CONCURRENTLY IF NOT EXISTS "products_store_id_code_idx"
  ON "products"("store_id", "code")
  WHERE (deleted_at IS NULL);

DROP INDEX CONCURRENTLY IF EXISTS "uq_products_store_code_active";
