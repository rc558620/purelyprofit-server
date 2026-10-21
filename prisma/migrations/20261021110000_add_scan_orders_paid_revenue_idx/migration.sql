/* ── 看板「今日营业额」聚合缺 (store_id, paid_at) 索引 ───────────
 * ScanOrderingDashboardService.getDashboard 每次被商家端轮询都执行：
 *   SELECT SUM(paid_amount) FROM scan_orders
 *   WHERE store_id = ?
 *     AND paid_at >= 上海今日 00:00 AND paid_at < 明日 00:00
 *     AND payment_status IN ('paid','refunding');
 * 现有索引没有一条能同时覆盖 store_id + paid_at：
 *   - idx_scan_orders_status_paid_at (status, paid_at)：前导列 status 未被约束，
 *     且不含 store_id；
 *   - scan_orders_store_id_created_at_idx (store_id, created_at)：过滤列是
 *     paid_at 而非 created_at。
 * 因此该聚合只能 Seq Scan，随 scan_orders 累积线性劣化；而看板是商家端
 * 秒级轮询接口，属于常驻高频负载。
 *
 * 本索引建成 partial：只收录 payment_status ∈ (paid, refunding) 且未软删除的
 * 行，即「已收款」这一小集合，索引体积不会随历史订单/未支付单膨胀。
 *
 * 生产环境说明：存量表上加索引建议改为
 *   CREATE INDEX CONCURRENTLY "idx_scan_orders_store_paid_revenue" ...
 * 单独在事务外执行（Prisma migrate 会把迁移包在事务里，CONCURRENTLY 无法在内运行）。
 *
 * 回滚：DROP INDEX IF EXISTS "idx_scan_orders_store_paid_revenue";
 */

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_scan_orders_store_paid_revenue"
  ON "scan_orders" ("store_id", "paid_at")
  WHERE "payment_status" IN ('paid', 'refunding')
    AND "deleted_at" IS NULL;
