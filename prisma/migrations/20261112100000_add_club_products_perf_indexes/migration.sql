/* ── C 端服务商品读链路索引优化 ─────────────────────────────
 *
 * club-product-query.service.ts 的主查询是：
 *   WHERE store_id = ? AND is_active = true [AND category_id = ?]
 *     [AND id < ?] [AND name LIKE '%kw%']
 *   ORDER BY id DESC LIMIT n
 *
 * 原表只有以 created_at / updated_at / price 收尾的索引，id 从未作为排序键
 * 进入索引，PG 必须过滤后额外 Sort；而 id 又是游标分页的排序依据。这里补两条
 * 与 where + order by 完全对齐的 btree，PG 可反向索引扫描直接取前 N 行。
 *
 * 同时删除 (store_id, name) 普通索引：它与唯一约束的前两列完全相同，属于纯
 * 冗余，删掉可抵消新增索引带来的大部分写放大。
 *
 * 新索引刻意不含 updated_at / stock。库存扣减（C 端下单 / 退款）是这张表
 * 最高频的写，只改 stock 与 updated_at；索引列不被更新时 PG 才能走 HOT，
 * 口径与 20261111100000 对 products 表的处理一致。
 *
 * name 上的 GIN trgm 承接 contains 生成的 LIKE '%kw%'，避免按 store_id
 * 取出全店商品后逐行匹配。pg_trgm 已在 20260610120000 启用。
 *
 * 生产环境说明：存量表建议改为 CREATE INDEX CONCURRENTLY ...，在事务外
 * 单独执行（Prisma migrate 会把迁移包在事务里，CONCURRENTLY 无法在内运行）。
 *
 * 回滚见同目录 migration_rollback.sql。
 */

-- 幂等兜底，避免新环境尚未启用扩展
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- DropIndex：与 (store_id, name) 唯一约束重复
DROP INDEX IF EXISTS "marketing_products_store_id_name_idx";

-- CreateIndex：游标分页排序（无分类 / 有分类两条路径）
CREATE INDEX IF NOT EXISTS "marketing_products_store_id_is_active_id_idx"
  ON "marketing_products"("store_id", "is_active", "id");

CREATE INDEX IF NOT EXISTS "marketing_products_store_id_is_active_category_id_id_idx"
  ON "marketing_products"("store_id", "is_active", "category_id", "id");

-- CreateIndex：商品名模糊搜索
CREATE INDEX IF NOT EXISTS "marketing_products_name_trgm_idx"
  ON "marketing_products" USING GIN (name gin_trgm_ops);
