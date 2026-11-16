-- 回滚：撤销 C 端储值账户余额快照使用的「门店 + 顾客 + 时间」复合索引
-- 只删索引，不动数据。代码侧回滚（git revert 余额快照下推）后本索引即无用，可安全删除；
-- 若先回滚代码、暂留索引也不影响正确性（仅多一份写放大）。
-- 线上为低峰执行；需要零锁阻塞时改用 DROP INDEX CONCURRENTLY（需在事务外单独执行）。

DROP INDEX IF EXISTS "idx_marketing_recharges_store_customer_created";
