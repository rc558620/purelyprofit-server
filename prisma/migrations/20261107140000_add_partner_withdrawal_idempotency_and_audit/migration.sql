-- 提现申请幂等键 + 审核/打款操作人审计字段
--
-- 背景：
-- 1. 原「事务外查重 + 5 秒窗口」既挡不住并发穿透、又会误拒 5 秒内同额的合法
--    二次申请。改为客户端幂等键 + 数据库唯一约束作为最终保障，时间窗口移除。
-- 2. 审核 / 打款此前只落申请时的 operator_staff_id，资金动作无法追责。
--
-- 兼容性与回滚：
-- 1. 三列均允许 NULL；PostgreSQL 唯一索引默认 NULLS DISTINCT，历史记录与
--    未携带幂等键的老客户端不会互相冲突，无需回填。
-- 2. 审计列刻意不建外键：员工被删除时历史资金记录仍可追溯。
-- 3. 纯增量变更；回滚依次 DROP INDEX / DROP COLUMN 即可。

-- AlterTable
ALTER TABLE "partner_withdrawals"
  ADD COLUMN "idempotency_key" VARCHAR(128),
  ADD COLUMN "reviewed_by_staff_id" INTEGER,
  ADD COLUMN "paid_by_staff_id" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "partner_withdrawals_store_id_idempotency_key_key"
  ON "partner_withdrawals"("store_id", "idempotency_key");
