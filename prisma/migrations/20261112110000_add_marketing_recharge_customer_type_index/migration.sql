/* ── C 端会员快照 · 累计充值聚合索引 ───────────────────────────
 *
 * club-member-profile.service.ts 的 aggregateTotalRechargeAmount 执行：
 *   SELECT SUM(amount) FROM marketing_recharges
 *   WHERE customer_id = ? AND type = 'recharge'
 *
 * 现有 marketing_recharges_customer_id_created_at_idx 只能按 customer_id
 * 定位，仍需扫描该顾客的全部充值/赠送/退款流水再逐行过滤 type；充值流水
 * 随门店运营持续增长，冷缓存下的首页会员快照会随之线性变慢。
 * 新增 (customer_id, type) 复合索引后可直接定位到 recharge 子集。
 *
 * 不建覆盖 amount 的索引：写放大与索引宽度收益不成正比，且充值流水
 * 为只追加写入，回表读取的行数已被 type 收敛。
 *
 * 生产环境说明：存量表建议改为 CREATE INDEX CONCURRENTLY ...，在事务外
 * 单独执行（Prisma migrate 会把迁移包在事务里，CONCURRENTLY 无法在内运行）。
 *
 * 回滚见同目录 migration_rollback.sql。
 */

-- CreateIndex：与 schema 中 map: "idx_marketing_recharges_customer_type" 对齐
CREATE INDEX IF NOT EXISTS "idx_marketing_recharges_customer_type"
  ON "marketing_recharges"("customer_id", "type");
