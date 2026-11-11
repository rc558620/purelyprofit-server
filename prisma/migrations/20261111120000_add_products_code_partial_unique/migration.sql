/* ── products 商品编号恢复部分唯一约束 ─────────────────────────
 * 背景：products 建表时曾有 (store_id, code) 唯一索引，软删除改造
 *   （20260625140000_step1_soft_delete_and_restrict_cascade）把它降级为普通
 *   索引，编号唯一性只剩应用层 findProductCodeConflict 先查后写兜底；
 *   并发创建 / 并发改号仍可写出重复编号。
 *
 * 本迁移把现有普通 partial index 升级为 partial UNIQUE index：
 *   - WHERE (deleted_at IS NULL) 与 catalog.prisma 的 where raw 完全一致，
 *     软删后编号可复用，不改变既有业务语义；
 *   - 先 DROP 再 CREATE，索引数量不变，不给库存扣减（峰值 ~70 QPS）增加
 *     写放大，也不会让 updated_at 重新进入索引而破坏 HOT 更新
 *     （见 20261111100000_remove_products_updated_at_from_indexes）；
 *   - 唯一性由库内保证后，应用层可去掉自动生成编号时的 5 轮查重循环。
 *
 * 上线前须核验存量重复编号（存在重复时本迁移会失败并整体回滚，
 * 不会留下「删了旧索引却没建新索引」的半状态）：
 *   SELECT store_id, code, count(*) FROM products
 *    WHERE deleted_at IS NULL GROUP BY store_id, code HAVING count(*) > 1;
 *
 * 生产环境说明：Prisma migrate 会把迁移包在事务里，CONCURRENTLY 无法在
 * 事务内运行。存量表建议在低峰期把下面两条手工改为 CONCURRENTLY 形式，
 * 在事务外单独执行并跳过本迁移（与 S8 索引迁移同一处理方式）。
 *
 * 回滚：见同目录 migration_rollback.sql；SQL 回滚后还须同步回退
 * catalog.prisma 的 @@unique 声明，否则 migrate dev / drift 检查会重建。
 */

DROP INDEX IF EXISTS "products_store_id_code_idx";

CREATE UNIQUE INDEX "uq_products_store_code_active"
  ON "products"("store_id", "code")
  WHERE (deleted_at IS NULL);
