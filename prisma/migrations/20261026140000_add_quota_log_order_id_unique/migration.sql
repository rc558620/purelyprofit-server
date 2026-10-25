-- 新客额度流水：充值单号唯一（防止同一笔支付重复发放额度）
--
-- 背景：额度发放的幂等原本只有一层——支付单上的「带状态条件更新」。
-- 一旦有调用方绕过支付单直接写流水（人工补偿脚本、将来新增的入口），
-- 同一笔支付就会被重复加额度且没有任何拦截。这里补数据库唯一约束作为最终兜底。
--
-- 兼容性：
-- 1. order_id 允许 NULL，PostgreSQL 唯一索引默认 NULLS DISTINCT，
--    赠送 / 消耗 / 清零等不关联订单的流水不会互相冲突，也不需要回填。
-- 2. 建索引前先给历史重复单号追加后缀（保留原流水、不删数据），避免建索引失败。
-- 3. 纯增量变更，回滚只需 DROP INDEX，不影响既有读写链路。

-- 历史重复单号去重：同门店同单号只保留最早一条，其余追加 -DUP{n} 后缀
WITH duplicated AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY store_id, order_id
      ORDER BY id
    ) AS seq
  FROM store_new_customer_quota_logs
  WHERE order_id IS NOT NULL
)
UPDATE store_new_customer_quota_logs AS logs
SET order_id = logs.order_id || '-DUP' || duplicated.seq
FROM duplicated
WHERE logs.id = duplicated.id
  AND duplicated.seq > 1;

-- CreateIndex
-- 注意：prisma migrate 在本迁移所在事务内执行该语句，会短暂阻塞本表写入。
-- 若该表已在生产累积大量数据，建议改为在业务低峰执行，或人工拆分：
--   CREATE UNIQUE INDEX CONCURRENTLY ...（CONCURRENTLY 不能在事务内运行）
CREATE UNIQUE INDEX "store_new_customer_quota_logs_store_id_order_id_key"
  ON "store_new_customer_quota_logs"("store_id", "order_id");
