-- 回滚：20261116120000_add_club_recharge_order_pending_indexes
-- 两条 partial index 均为纯读路径优化，删除不影响任何业务语义与数据。
-- 线上建议 CONCURRENTLY 删除（不阻塞写入），低峰执行亦可。

DROP INDEX CONCURRENTLY IF EXISTS "idx_club_recharge_orders_pending_expiry";
DROP INDEX CONCURRENTLY IF EXISTS "idx_club_recharge_orders_pending_created";
