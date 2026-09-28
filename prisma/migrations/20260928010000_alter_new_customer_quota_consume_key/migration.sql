-- ═══════════════════════════════════════════════════════════
-- 新客消耗：幂等键与「是否新客」判定从「手机号」改为「C 端账号 ID」
--
-- 原因：扫码进桌即建档（占位手机号 `club_wechat:{openid}`），绑定手机号时
-- 该档案会被迁移成真实号码，于是按手机号判定「本店是否已有该顾客」必然为真，
-- 首单新客被误判成老客 → 额度永不消耗，「额度用完阻止下单」无从谈起。
--
-- phone 放宽为可空并降级为快照字段：未绑手机号的用户也能下单成为新客。
-- ═══════════════════════════════════════════════════════════

-- AlterTable：先以可空列落地，回填后再收紧为 NOT NULL
ALTER TABLE "store_new_customer_quota_consumes"
  ADD COLUMN "club_user_id" INTEGER,
  ALTER COLUMN "phone" DROP NOT NULL;

-- 回填历史记录（两步都不可省）：
-- ① 手机号能直接对上档案的真实号码；
-- ② 手机号是**占位号** `club_wechat:{openid}` 的——扫码进桌即建档用占位号，
--    绑定手机号后 `marketing_customers.phone` 被迁成真实号码，按手机号永远 join 不上。
--    这类记录恰恰是旧口径下**已经扣过额度**的老客，漏掉会让 `isNewCustomer` 返回 true、
--    下次下单再扣一次额度，必须按 external_identifier（openid）反查回填。
UPDATE "store_new_customer_quota_consumes" AS c
SET "club_user_id" = m."club_user_id"
FROM "marketing_customers" AS m
WHERE m."store_id" = c."store_id"
  AND m."club_user_id" IS NOT NULL
  AND c."club_user_id" IS NULL
  AND (
    m."phone" = c."phone"
    OR (
      c."phone" LIKE 'club_wechat:%'
      AND m."external_identifier" = substring(c."phone" from 13)
    )
  );

-- 回填后同一账号可能有多条历史记录（同一顾客用不同手机号下过单），
-- 唯一约束只留最早的一条
DELETE FROM "store_new_customer_quota_consumes" AS c
USING "store_new_customer_quota_consumes" AS d
WHERE c."club_user_id" IS NOT NULL
  AND d."club_user_id" IS NOT NULL
  AND c."store_id" = d."store_id"
  AND c."club_user_id" = d."club_user_id"
  AND c."id" > d."id";

-- 仍归属不到账号的记录：**归档**而不是直接丢弃。
-- 它们大概率是已扣过额度的老客记录，物理删除会让这些老客被重新判成新客、重复扣额度。
CREATE TABLE "store_new_customer_quota_consumes_unresolved_20260928" AS
SELECT * FROM "store_new_customer_quota_consumes" WHERE "club_user_id" IS NULL;

DELETE FROM "store_new_customer_quota_consumes" WHERE "club_user_id" IS NULL;

ALTER TABLE "store_new_customer_quota_consumes"
  ALTER COLUMN "club_user_id" SET NOT NULL;

-- DropIndex
DROP INDEX IF EXISTS "store_new_customer_quota_consumes_store_id_phone_key";

-- CreateIndex
CREATE UNIQUE INDEX "store_new_customer_quota_consumes_store_id_club_user_id_key"
  ON "store_new_customer_quota_consumes"("store_id", "club_user_id");

-- CreateIndex
CREATE INDEX "store_new_customer_quota_consumes_store_id_phone_idx"
  ON "store_new_customer_quota_consumes"("store_id", "phone");
