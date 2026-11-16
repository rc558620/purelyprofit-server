-- 回滚：撤销 C 端团购券订单的 keyset 分页索引与过期翻转扫描索引
-- 只删索引，不动数据。
-- 代码侧回滚（git revert 第 3 批游标改造 + 过期翻转定时任务）后这两个索引即无用，可安全删除；
-- 若先回滚代码、暂留索引也不影响正确性（仅多一份写放大）。
-- 线上为低峰执行；需要零锁阻塞时改用 DROP INDEX CONCURRENTLY（需在事务外单独执行）。

DROP INDEX IF EXISTS "club_voucher_orders_status_expires_idx";
DROP INDEX IF EXISTS "club_voucher_orders_user_created_id_idx";
