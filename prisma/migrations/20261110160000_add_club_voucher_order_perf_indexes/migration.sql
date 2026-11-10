/* ── club_voucher_orders 读路径部分索引（2 条）────────────────
 * 本批只加物理索引，不改任何业务代码、接口契约与查询条件。
 * 两条均为 partial index，谓词只纳入目标子集，写放大可控。
 *
 * 1. 商家端列表惰性过期（voucher-orders.service.ts:expireOverdueStoreOrders）
 *      UPDATE club_voucher_orders SET status = 'expired'
 *       WHERE store_id = ? AND status = 'pending' AND expires_at < now()
 *    该语句在每次「商家端团购券订单列表」请求前必跑。现有
 *    [store_id, status, created_at DESC] 只能用前两列定位到该店全部
 *    pending 历史订单，再逐行回表判断 expires_at；多数请求其实没有任何
 *    过期单，却仍要扫一遍。补 (store_id, status, expires_at) 后，
 *    expires_at < now() 变成索引内的范围扫描，0 命中时直接结束。
 *    谓词 expires_at IS NOT NULL 排除未支付草稿（草稿不写有效期），
 *    且严格小于比较蕴含非空，PG 可证明查询条件包含索引谓词。
 *
 * 2. 营销顾客退款冲减（marketing-customer-list.service.ts 的 groupBy、
 *    marketing-customer-consumption-stats.util.ts 的 aggregate）
 *      WHERE customer_id IN (...) AND status = 'refunded'
 *        AND payment_channel = 'balance' AND refund_amount_fen IS NOT NULL
 *    两处都按 customerId 过滤本表，此前无 customer_id 前导索引，
 *    退化为全表扫描。谓词 refund_amount_fen IS NOT NULL 只纳入退款单
 *    （占比极小），索引体量远小于全表。
 *
 * 写放大评估：本表日增约 5 千行，两条索引均为窄列 btree + 高选择性
 * partial 谓词；订单状态流转时只涉及索引条目移入/移出。
 * 不建关键词 GIN(trgm) 索引：pg_trgm 虽已启用，但商家端列表默认带当日
 * 时间范围，ILIKE '%kw%' 的扫描集已很小，GIN 的写入维护成本反而更高；
 * 也不改 offset 分页（会动接口契约，需三端同步确认后再做）。
 *
 * 时区假设：expires_at 为 timestamptz，比较在 PG 侧以 UTC 进行，
 * 本迁移不涉及时间列转换或数据回填。
 *
 * 生产环境说明：Prisma migrate 会把迁移包在事务里，CONCURRENTLY 无法
 * 在事务内运行。存量表建议在低峰期把下面两条手工改为
 *   CREATE INDEX CONCURRENTLY IF NOT EXISTS ...
 * 在事务外单独执行，并跳过本迁移（与 S8 索引迁移同一处理方式）。
 *
 * 回滚：见同目录 migration_rollback.sql；完整回滚还需同步回退
 * voucher-orders.prisma 中的两条 @@index 声明，避免再次产生 drift。
 */

-- 1. 门店惰性过期：按 (store_id, status) 等值 + expires_at 范围定位
CREATE INDEX IF NOT EXISTS "club_voucher_orders_store_status_expires_idx"
  ON "club_voucher_orders" ("store_id", "status", "expires_at")
  WHERE (expires_at IS NOT NULL);

-- 2. 退款冲减聚合：按 customer_id 定位已退款余额支付订单
CREATE INDEX IF NOT EXISTS "club_voucher_orders_customer_refund_balance_idx"
  ON "club_voucher_orders" ("customer_id", "status", "payment_channel")
  WHERE (refund_amount_fen IS NOT NULL);
