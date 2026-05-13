-- CreateEnum
CREATE TYPE "SubscriptionPlanCode" AS ENUM ('STARTER', 'GROWTH', 'PRO', 'CUSTOM');

-- CreateEnum
CREATE TYPE "StoreSubscriptionStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'CANCELLED');

-- CreateTable
CREATE TABLE "store_subscriptions" (
  "id" SERIAL NOT NULL,
  "store_id" INTEGER NOT NULL,
  "plan_code" "SubscriptionPlanCode" NOT NULL,
  "plan_name" TEXT NOT NULL,
  "status" "StoreSubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
  "max_account_seats" INTEGER NOT NULL,
  "starts_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "store_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "store_subscriptions_store_id_key" ON "store_subscriptions"("store_id");

-- CreateIndex
CREATE INDEX "store_subscriptions_status_idx" ON "store_subscriptions"("status");

-- AddForeignKey
ALTER TABLE "store_subscriptions"
ADD CONSTRAINT "store_subscriptions_store_id_fkey"
FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill
INSERT INTO "store_subscriptions" (
  "store_id",
  "plan_code",
  "plan_name",
  "status",
  "max_account_seats",
  "starts_at",
  "created_at",
  "updated_at"
)
SELECT
  s."id",
  CASE
    WHEN s."max_account_seats" <= 1 THEN 'STARTER'::"SubscriptionPlanCode"
    WHEN s."max_account_seats" = 2 THEN 'GROWTH'::"SubscriptionPlanCode"
    WHEN s."max_account_seats" = 3 THEN 'PRO'::"SubscriptionPlanCode"
    ELSE 'CUSTOM'::"SubscriptionPlanCode"
  END,
  CASE
    WHEN s."max_account_seats" <= 1 THEN '基础版'
    WHEN s."max_account_seats" = 2 THEN '成长版'
    WHEN s."max_account_seats" = 3 THEN '专业版'
    ELSE CONCAT(s."max_account_seats", '账号版')
  END,
  'ACTIVE'::"StoreSubscriptionStatus",
  s."max_account_seats",
  s."created_at",
  s."created_at",
  s."updated_at"
FROM "stores" s;