/* ── 客存列表默认 Tab 缺失索引 ──────────────────────────────
 * 客存列表默认进入 status=all 的 Tab，查询形态是
 *   WHERE store_id = ? AND deleted_at IS NULL ORDER BY created_at DESC, id DESC
 * 现有 idx_custody_orders_store_status_created 的前导列是 status，
 * all 条件不带 status 谓词，PostgreSQL 无法用它做有序扫描（无 skip scan），
 * 只能 Seq Scan + Sort；数据量增长后列表首屏会显著劣化。
 * 本索引直接支撑 (store_id, created_at DESC) 的有序扫描。
 *
 * 生产环境说明：存量表上加索引建议改为
 *   CREATE INDEX CONCURRENTLY ...
 * 单独在事务外执行（Prisma migrate 会把迁移包在事务里，CONCURRENTLY 无法在内运行）。
 *
 * 回滚：DROP INDEX IF EXISTS "idx_custody_orders_store_created";
 */

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_custody_orders_store_created" ON "custody_orders"("store_id", "created_at" DESC) WHERE "deleted_at" IS NULL;
