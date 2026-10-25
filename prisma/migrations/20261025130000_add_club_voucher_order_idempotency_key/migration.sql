-- 团购券订单幂等键（purelyClub C 端下单）
--
-- 背景：团购券下单会扣库存与新客额度，双击 / 网络重试会产生第二单。
-- 之前只有 Redis 兜底（缓存丢失即失效），这里补数据库唯一约束作为最终保障。
--
-- 兼容性：
-- 1. 新列允许 NULL，PostgreSQL 唯一索引默认 NULLS DISTINCT，历史数据与
--    未携带幂等键的老客户端不会互相冲突，也不需要回填。
-- 2. 只加列 + 唯一索引，是纯增量变更，回滚只需 DROP INDEX / DROP COLUMN，
--    不影响既有读写链路。
-- 3. 先建列再建索引，避免在已有大表上一次锁表过久。

-- AlterTable
ALTER TABLE "club_voucher_orders" ADD COLUMN "idempotency_key" VARCHAR(128);

-- CreateIndex
CREATE UNIQUE INDEX "club_voucher_orders_user_id_idempotency_key_key"
  ON "club_voucher_orders"("user_id", "idempotency_key");
