/* ── products 关键词搜索缺三元组索引 ─────────────────────────
 *
 * sales-record-products.service.ts（开始营业 / 追加点单商品列表）在传 keyword 时，
 * 对 name / code / category 三列做 `contains` + `mode: 'insensitive'`，
 * 编译为三条 `ILIKE '%kw%'` 的 OR：
 *
 *   WHERE store_id = ? AND deleted_at IS NULL AND is_active = true
 *     AND (name ILIKE '%kw%' OR code ILIKE '%kw%' OR category ILIKE '%kw%')
 *
 * 前后都有通配符，btree 索引无法用于前缀匹配，只能退化为按 store_id 取出该店
 * 全部商品后逐行做三次正则匹配。商品少的门店无感，商品上千的门店每次搜索
 * 都是一次全店扫描。
 *
 * pg_trgm 扩展已在 20260610120000_add_search_trgm_indexes 中启用，这里补三个
 * GIN 索引，让 ILIKE '%kw%' 走位图索引扫描。
 *
 * 只索引被搜索的三列，不包含 stock / price 等高频更新列：销售扣减只改 stock，
 * 不会触发这三个索引的维护开销。
 *
 * 生产环境说明：存量表建议改为
 *   CREATE INDEX CONCURRENTLY ...
 * 在事务外单独执行（Prisma migrate 会把迁移包在事务里，CONCURRENTLY 无法在内运行）。
 *
 * 回滚：
 *   DROP INDEX IF EXISTS "products_name_trgm_idx";
 *   DROP INDEX IF EXISTS "products_code_trgm_idx";
 *   DROP INDEX IF EXISTS "products_category_trgm_idx";
 */

CREATE INDEX IF NOT EXISTS "products_name_trgm_idx"
  ON "products" USING GIN (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "products_code_trgm_idx"
  ON "products" USING GIN (code gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "products_category_trgm_idx"
  ON "products" USING GIN (category gin_trgm_ops);
