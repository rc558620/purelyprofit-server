/* ── 扫码点餐超时扫描缺 (status, paid_at/accepted_at) 索引 ───────
 * ScanOrderingAcceptanceExpirationService 每 60s 扫描一次超时订单：
 *   - 待接单超时：status = 'pending_acceptance' AND paid_at <= now - 30min
 *   - 制作中超时：status = 'preparing'       AND accepted_at <= now - 2h
 * 两者都还带 deleted_at IS NULL，且不带 storeId（全局扫描）。
 * 现有索引全部以 storeId 为前导列，或用不上时间列
 * （idx_scan_orders_payment_expiry 只覆盖 payment_expires_at），
 * 因此每轮扫描都是全表扫描，表随运营时间增长后成为常驻后台负载。
 * 本批两条 partial 索引把扫描集收敛到「活跃在途单」这个小集合。
 *
 * 生产环境说明：存量表上加索引建议改为
 *   CREATE INDEX CONCURRENTLY ...
 * 单独在事务外执行（Prisma migrate 会把迁移包在事务里，CONCURRENTLY 无法在内运行）。
 *
 * 回滚：
 *   DROP INDEX IF EXISTS "idx_scan_orders_status_paid_at";
 *   DROP INDEX IF EXISTS "idx_scan_orders_status_accepted_at";
 */

-- 1. 待接单超时扫描（status + paid_at）
CREATE INDEX IF NOT EXISTS "idx_scan_orders_status_paid_at"
  ON "scan_orders" ("status", "paid_at")
  WHERE "deleted_at" IS NULL;

-- 2. 制作中超时扫描（status + accepted_at）
CREATE INDEX IF NOT EXISTS "idx_scan_orders_status_accepted_at"
  ON "scan_orders" ("status", "accepted_at")
  WHERE "deleted_at" IS NULL;
