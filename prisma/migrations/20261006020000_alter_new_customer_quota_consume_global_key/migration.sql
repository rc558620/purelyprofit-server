-- ═══════════════════════════════════════════════════════════
-- 新客消耗：唯一键从「门店 + 账号」收紧为「账号」全局唯一
--
-- 额度计量的是「手机号认证」（微信 getPhoneNumber，0.03 元/次），而一位顾客
-- 的手机号一生只需认证一次：在 A 店认证过之后，换到 B / C / D 店都不该再
-- 要求验证一次手机号，也不该再扣一次额度。
--
-- 旧口径下同一顾客在每家门店各留一条消耗记录 → 每换一家店就多扣一个额度，
-- 且「换店要不要再认证手机号」的判定随门店漂移。收紧为账号全局唯一后：
-- 额度由**第一家服务该顾客的门店**承担，之后所有门店共享同一次认证结果。
-- ═══════════════════════════════════════════════════════════

-- 历史数据去重：同一账号只留最早的一条（即第一家为其支付额度的门店）。
-- 各门店的「已服务新客」计数取自 store_membership_profiles.new_customer_quota_consumed，
-- 删除重复的消耗记录不会改变商家端已展示的历史数字。
--
-- 先归档再删：与 20260928 那条迁移同一做法，便于审计与人工回滚。
CREATE TABLE "store_new_customer_quota_consumes_deduped_20261006" AS
SELECT c.*
FROM "store_new_customer_quota_consumes" AS c
JOIN "store_new_customer_quota_consumes" AS d
  ON c."club_user_id" = d."club_user_id" AND c."id" > d."id";

DELETE FROM "store_new_customer_quota_consumes" AS c
USING "store_new_customer_quota_consumes" AS d
WHERE c."club_user_id" = d."club_user_id"
  AND c."id" > d."id";

-- DropIndex
DROP INDEX IF EXISTS "store_new_customer_quota_consumes_store_id_club_user_id_key";

-- CreateIndex
CREATE UNIQUE INDEX "store_new_customer_quota_consumes_club_user_id_key"
  ON "store_new_customer_quota_consumes"("club_user_id");
