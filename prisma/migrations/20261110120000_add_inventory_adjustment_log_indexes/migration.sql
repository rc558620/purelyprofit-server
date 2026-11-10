/* ── 库存调整流水查询索引（2 条新增 + 1 条冗余清理）────────────
 * inventory_adjustment_logs 是 goods 域增长最快的表（档B 日增 ~10万行、
 * 年增 ~3650万行），而 listAdjustments 的两种高频读路径都缺可用索引：
 *
 * 1. 默认列表（queryInventoryAdjustmentPage，inventory.query.ts:166-186）
 *      WHERE store_id = ? ORDER BY created_at DESC, id DESC LIMIT / OFFSET
 *    现有 inventory_adjustment_logs_store_id_created_at_idx 是
 *    (store_id, created_at ASC)：created_at 可反向扫描，但缺 id 作为二级
 *    排序列，PG 必须把命中行全部取出再做一次 top-N sort；单店流水越多、
 *    分页越深，排序代价越大。补 (store_id, created_at DESC, id DESC) 后
 *    可直接按索引有序输出，取满 LIMIT 即提前终止扫描。
 *
 * 2. 关键字搜索：product_name 的 contains + mode: 'insensitive' 编译为
 *    ILIKE '%kw%'（inventory.query.ts:156-163），前后通配符让 btree 失效，
 *    退化成按 store_id 取出该店全部历史流水逐行做正则匹配。
 *    pg_trgm 已在 20260610120000_add_search_trgm_indexes 启用，这里补 GIN
 *    索引让 ILIKE 走位图索引扫描（与 products 三列 trgm 索引同一方案）。
 *
 * 写放大评估：该表是纯 append-only 流水，product_name 是下单时的名称快照
 * 不参与 UPDATE，新增索引只增加 INSERT 时的索引维护；相对避免全店历史流水
 * 全表扫描 + filesort 的读侧收益，代价可控。故只补这两条，不再追加
 * adjust_type 复合索引（低基数枚举，可由上述索引扫描后过滤）。
 *
 * 生产环境说明：存量表建议改为 CREATE INDEX CONCURRENTLY，在事务外单独执行
 * （Prisma migrate 会把迁移包在事务里，CONCURRENTLY 无法在内运行）。
 *
 * 回滚：见同目录 migration_rollback.sql
 */

-- 1. 默认列表：门店 + 时间倒序 + id 稳定次序，消除 filesort
CREATE INDEX IF NOT EXISTS "idx_inventory_adjustment_logs_store_created_id_desc"
  ON "inventory_adjustment_logs" ("store_id", "created_at" DESC, "id" DESC);

-- 2. 关键字搜索：ILIKE '%kw%' 走位图索引扫描
CREATE INDEX IF NOT EXISTS "idx_inventory_adjustment_logs_product_name_trgm"
  ON "inventory_adjustment_logs" USING GIN ("product_name" gin_trgm_ops);

-- 3. 索引 1 是旧 (store_id, created_at) 的完整超集（前缀相同、多一列 id，
--    排序方向可反向扫描），旧索引已冗余，DROP 以免多一份写放大。
--    先 CREATE 后 DROP，保证迁移任何阶段都有可用索引覆盖列表查询。
DROP INDEX IF EXISTS "inventory_adjustment_logs_store_id_created_at_idx";
