/* 回滚：删除 2 条新增索引
 * 全部 CONCURRENTLY 无锁表，执行顺序与正向迁移相反。
 * SQL 回滚后还需回退 voucher-orders.prisma 中的两条 @@index 声明，
 * 否则后续 migrate dev / drift 检查会把索引重新建回来。
 */

-- 2. 退款冲减聚合
DROP INDEX CONCURRENTLY IF EXISTS "club_voucher_orders_customer_refund_balance_idx";

-- 1. 门店惰性过期
DROP INDEX CONCURRENTLY IF EXISTS "club_voucher_orders_store_status_expires_idx";
