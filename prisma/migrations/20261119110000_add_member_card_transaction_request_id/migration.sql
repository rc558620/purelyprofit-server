-- 调次幂等键：写成功但响应丢失时，客户端重试复用同一 requestId，
-- 由唯一约束兜底，避免同一笔调整被重复加/减次数。
ALTER TABLE "member_card_transactions" ADD COLUMN "request_id" VARCHAR(64);

-- NULL 表示未携带幂等键（历史流水与非调次流水），PostgreSQL 唯一索引允许多个 NULL。
CREATE UNIQUE INDEX "uq_member_card_transactions_card_request"
    ON "member_card_transactions"("card_id", "request_id");
