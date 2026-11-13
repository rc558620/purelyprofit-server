/* 回滚：移除 C 端会员快照累计充值聚合索引。
 *
 * 索引删除后 aggregateTotalRechargeAmount 回退到
 * marketing_recharges_customer_id_created_at_idx，查询语义不变，仅性能退化。
 * CONCURRENTLY 需在事务外单独执行，避免长时间持锁阻塞充值写入。
 */
DROP INDEX CONCURRENTLY IF EXISTS "idx_marketing_recharges_customer_type";
