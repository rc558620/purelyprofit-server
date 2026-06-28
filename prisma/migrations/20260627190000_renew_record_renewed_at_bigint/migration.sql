-- AlterColumn: space_session_renew_records.renewed_at 从 INTEGER 改为 BIGINT
-- 原因：Date.now() 返回毫秒时间戳（~13位），超出 32 位整数范围
ALTER TABLE "space_session_renew_records" ALTER COLUMN "renewed_at" SET DATA TYPE BIGINT;
