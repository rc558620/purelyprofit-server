/* ── C 端储值账户余额快照 · 门店 + 顾客窗口扫描索引 ─────────────
 *
 * club-record-balance-window.query.ts 在 DB 侧用窗口函数求余额快照：
 *   SELECT ... FROM marketing_recharges
 *   WHERE store_id = ? AND customer_id = ? AND created_at >= ?
 *   ORDER BY created_at, ... （窗口函数内部按该序扫描）
 *
 * 既有索引：
 *   - (store_id, created_at)：顾客维度只能回表过滤，扫全店充值流水
 *   - (customer_id, created_at)：门店维度只能回表过滤，跨店扫同 id 顾客
 *   - (customer_id, type)：缺时间列，窗口区间扫描无法收敛
 * 三者都缺 (store_id, customer_id) 等值前导，深分页时扫描量随单店充值流水线性增长。
 * 新增 (store_id, customer_id, created_at) 后可直接定位到「单店单顾客」的连续时间区间。
 *
 * 时区假设：本迁移不改时间列类型，created_at 仍为 TIMESTAMP(3) WITHOUT TIME ZONE，
 *           与应用会话时区 UTC 保持一致。
 * 上线提示：
 *   * marketing_recharges 为只追加的流水表，线上规模可能较大。默认按低峰窗口执行；
 *     如需零锁阻塞，手工改用 CREATE INDEX CONCURRENTLY 后跳过本迁移（Prisma migrate
 *     会把迁移包在事务里，CONCURRENTLY 无法在事务内运行）：
 *       CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_marketing_recharges_store_customer_created"
 *         ON "marketing_recharges"("store_id", "customer_id", "created_at");
 *   * 首次回滚后重建该索引同样建议 CONCURRENTLY。
 * 回滚见 prisma/rollback/20261116140000_add_marketing_recharges_store_customer_created_index.rollback.sql
 */

-- CreateIndex：与 schema 中 map: "idx_marketing_recharges_store_customer_created" 对齐
CREATE INDEX IF NOT EXISTS "idx_marketing_recharges_store_customer_created"
  ON "marketing_recharges"("store_id", "customer_id", "created_at");
