/* ── C 端「我的客存」：会员维度 keyset 分页索引 ───────────────────────────
 *
 * 查询形态（src/purely-club/custody/club-custody-read.service.ts）：
 *   WHERE store_id = $1 AND member_id = $2 AND deleted_at IS NULL
 *   ORDER BY created_at DESC, id DESC
 *   LIMIT n + 1
 *
 * 既有索引：
 *   - idx_custody_orders_store_member_status (store_id, member_id, status)
 *     第三列是 status，默认 Tab（status=all）不带 status 条件时，索引在
 *     (store_id, member_id) 之后无序，无法服务 ORDER BY created_at DESC。
 *   - idx_custody_orders_store_created (store_id, created_at DESC)
 *     能按序扫描，但只能覆盖整店，需要回表逐行过滤 member_id ——
 *     门店存单量越大，会员看自己那几单付出的代价越高。
 *
 * 新增索引后：会员维度的第一页 / 后续页都退化为「索引区间有序扫描 + LIMIT」，
 * 扫描行数从「全店近期存单」收敛为「本页 + 1 行」。
 *
 * 写放大评估：存单是低频写表（存入、取出、作废各一次），member_id 与 created_at
 * 均在插入时确定、之后不再更新；部分索引谓词排除软删行，索引体积随时间收敛。
 *
 * 上线提示：
 *   * 若线上 custody_orders 规模较大，可在低峰窗口执行；
 *     如需零锁阻塞，手工改用 CREATE INDEX CONCURRENTLY 后跳过本迁移
 *     （Prisma migrate 把迁移包在事务里，CONCURRENTLY 不能在事务内运行）：
 *       CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_custody_orders_store_member_created"
 *         ON "custody_orders"("store_id", "member_id", "created_at" DESC)
 *         WHERE "deleted_at" IS NULL;
 * 回滚见 prisma/rollback/20261116180000_add_custody_orders_member_created_index.rollback.sql
 */

-- CreateIndex：与 schema 中 map: "idx_custody_orders_store_member_created" 对齐
CREATE INDEX IF NOT EXISTS "idx_custody_orders_store_member_created"
  ON "custody_orders"("store_id", "member_id", "created_at" DESC)
  WHERE "deleted_at" IS NULL;
