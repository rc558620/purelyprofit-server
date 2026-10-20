/* ── scan_orders 缺 session_id 索引 ────────────────────────────
 * PostgreSQL 不会为外键自动建索引，scan_orders.session_id 此前无任何索引，
 * 所有「按会话查订单」的高频读路径都只能 Seq Scan：
 *   1. C 端 listOrders 的 session.orders include
 *      （club-scan-ordering-order-query.service.ts）
 *   2. getCurrentSession 的 orders: { some: ... } 子查询
 *      （club-scan-ordering-session.service.ts）
 *   3. 商家端 dashboard 的 session: { is: { sessions: ... } } 计数
 *      （scan-ordering-dashboard.service.ts）
 *   4. 会话自动归档的 orders: { some / none }
 *      （scan-ordering-session-archive.service.ts）
 * 上述查询均带 deleted_at IS NULL，故建成 partial 索引，
 * 同时排除 session_id IS NULL 的行（手工补录单可能不带会话）以缩小索引体积。
 *
 * 生产环境说明：存量表上加索引建议改为
 *   CREATE INDEX CONCURRENTLY "idx_scan_orders_session_created" ...
 * 单独在事务外执行（Prisma migrate 会把迁移包在事务里，CONCURRENTLY 无法在内运行）。
 *
 * 回滚：DROP INDEX IF EXISTS "idx_scan_orders_session_created";
 */

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_scan_orders_session_created"
  ON "scan_orders" ("session_id", "created_at" DESC)
  WHERE "session_id" IS NOT NULL AND "deleted_at" IS NULL;
