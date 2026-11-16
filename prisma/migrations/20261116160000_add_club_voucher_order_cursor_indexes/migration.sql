/* ── C 端团购券订单：keyset 分页全序索引 + 过期翻转扫描索引 ─────────────────
 *
 * 背景（第 3 批 offset → 游标改造）：
 * 1) GET /api/club/voucher-orders 从 offset 分页改为 keyset 分页，排序链为
 *    `created_at DESC, id DESC`（all / pending Tab）。既有索引
 *    `(user_id, status, created_at DESC)` 在 status 是范围谓词
 *    （`status <> 'unpaid'`）时无法保证 created_at 有序，也缺 id 兜底，
 *    深页只能「取出该用户全部订单再排序」。
 *    新增 (user_id, created_at DESC, id DESC) 后可直接有序扫描，
 *    并在 key 内完成「跳过已读行」。
 *
 * 2) 读接口不再夹带惰性过期写，过期翻转改由 `club-voucher-order-expiry` 定时任务承担，
 *    其扫描条件是全局的 `status = 'pending' AND expires_at < now`。
 *    既有 (store_id, status, expires_at) 前导列是门店，无法服务跨门店全局扫描；
 *    新增 (status, expires_at) 部分索引（排除无有效期的未支付草稿）后，
 *    单轮扫描从「全表顺序扫 + 过滤」收敛为「索引区间扫描」。
 *
 * 写放大评估：
 *  - 两列组合均为「下单时写入、状态流转时少量更新」，且 order 表写入频率远低于读；
 *  - created_at / id 永不更新，插入后不再产生索引维护开销。
 *
 * 时区假设：不改时间列类型，created_at / expires_at 仍为 TIMESTAMP(3) WITHOUT TIME ZONE，
 *           与应用会话时区 UTC 保持一致；`now` 由应用侧以 UTC Date 传入，不依赖库时区。
 *
 * 上线提示：
 *   * club_voucher_orders 为订单主表，线上规模可能较大。默认按低峰窗口执行；
 *     如需零锁阻塞，手工改用 CREATE INDEX CONCURRENTLY 后跳过本迁移
 *     （Prisma migrate 会把迁移包在事务里，CONCURRENTLY 无法在事务内运行）：
 *       CREATE INDEX CONCURRENTLY IF NOT EXISTS "club_voucher_orders_user_created_id_idx"
 *         ON "club_voucher_orders"("user_id", "created_at" DESC, "id" DESC);
 *       CREATE INDEX CONCURRENTLY IF NOT EXISTS "club_voucher_orders_status_expires_idx"
 *         ON "club_voucher_orders"("status", "expires_at") WHERE "expires_at" IS NOT NULL;
 *   * 首次回滚后重建索引同样建议 CONCURRENTLY。
 * 回滚见 prisma/rollback/20261116160000_add_club_voucher_order_cursor_indexes.rollback.sql
 */

-- CreateIndex：与 schema 中 map: "club_voucher_orders_user_created_id_idx" 对齐
CREATE INDEX IF NOT EXISTS "club_voucher_orders_user_created_id_idx"
  ON "club_voucher_orders"("user_id", "created_at" DESC, "id" DESC);

-- CreateIndex：与 schema 中 map: "club_voucher_orders_status_expires_idx" 对齐
CREATE INDEX IF NOT EXISTS "club_voucher_orders_status_expires_idx"
  ON "club_voucher_orders"("status", "expires_at")
  WHERE "expires_at" IS NOT NULL;
