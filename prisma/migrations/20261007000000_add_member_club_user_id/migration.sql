-- AlterTable
-- Member 与 club 账号之间的身份锚点。
--
-- club 侧此前只能按 phone 定位会员（`members.some({ phone })`），而 phone 既会变
-- （换绑手机号后旧号码可能被他人注册）又可能在同一门店重复（历史重复导入），
-- 两种情况都会让查询命中**不属于当前登录者**的会员档案。
--
-- 加列后改用 (store_id, club_user_id) 定位，与 MarketingCustomer 的
-- uq_marketing_customers_store_club_user 对齐。
--
-- 可为 NULL：商家手工建档与历史数据没有对应的 club 账号。

-- AlterTable
ALTER TABLE "members" ADD COLUMN "club_user_id" INTEGER;

-- CreateIndex
-- 部分唯一索引：同一 club 用户在一家门店最多一条会员档案；NULL 不参与约束，
-- 因此没有 club 账号的会员记录不受影响。
CREATE UNIQUE INDEX "uq_members_store_club_user" ON "members"("store_id", "club_user_id") WHERE "club_user_id" IS NOT NULL;
