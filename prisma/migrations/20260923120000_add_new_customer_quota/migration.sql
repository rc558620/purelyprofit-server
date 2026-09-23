-- ═══════════════════════════════════════════════════════════
-- 新用户额度：门店维度的「微信 getPhoneNumber 调用次数」余额
--
-- - store_membership_profiles：新增余额字段 new_customer_quota
--   （还能服务多少位新客）与累计消耗 new_customer_quota_consumed
-- - store_new_customer_quota_logs：充值 / 赠送 / 消耗 / 清零流水
-- - store_new_customer_quota_consumes：新客消耗幂等表
--   （同店同手机号唯一，保证老顾客重复绑定不重复扣减）
-- ═══════════════════════════════════════════════════════════

-- CreateEnum
CREATE TYPE "StoreNewCustomerQuotaLogType" AS ENUM ('recharge', 'grant', 'consume', 'clear');

-- CreateTable
CREATE TABLE "store_new_customer_quota_logs" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "type" "StoreNewCustomerQuotaLogType" NOT NULL,
    "change_amount" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "amount_fen" INTEGER,
    "order_id" TEXT,
    "description" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_new_customer_quota_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "store_new_customer_quota_logs_store_id_created_at_idx"
  ON "store_new_customer_quota_logs"("store_id", "created_at");

-- CreateIndex
CREATE INDEX "store_new_customer_quota_logs_store_id_type_created_at_idx"
  ON "store_new_customer_quota_logs"("store_id", "type", "created_at");

-- CreateTable
CREATE TABLE "store_new_customer_quota_consumes" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "phone" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_new_customer_quota_consumes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "store_new_customer_quota_consumes_store_id_phone_key"
  ON "store_new_customer_quota_consumes"("store_id", "phone");

-- AlterTable
ALTER TABLE "store_membership_profiles"
  ADD COLUMN "new_customer_quota" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "new_customer_quota_consumed" INTEGER NOT NULL DEFAULT 0;
