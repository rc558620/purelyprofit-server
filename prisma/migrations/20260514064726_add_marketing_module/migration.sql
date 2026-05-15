/*
  Warnings:

  - Made the column `role` on table `staffs` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateEnum
CREATE TYPE "MarketingCustomerTier" AS ENUM ('regular', 'silver', 'gold', 'diamond');

-- CreateEnum
CREATE TYPE "MarketingRechargeType" AS ENUM ('recharge', 'gift', 'refund');

-- CreateEnum
CREATE TYPE "MarketingPayType" AS ENUM ('balance', 'cash', 'wechat', 'alipay', 'mixed');

-- CreateEnum
CREATE TYPE "MarketingPromotionType" AS ENUM ('discount', 'reduce', 'recharge_gift', 'free', 'points_2x');

-- AlterTable
ALTER TABLE "staffs" ALTER COLUMN "role" SET NOT NULL;

-- AlterTable
ALTER TABLE "store_subscriptions" ALTER COLUMN "updated_at" DROP DEFAULT;

-- CreateTable
CREATE TABLE "marketing_customers" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "avatar" TEXT,
    "tier" "MarketingCustomerTier" NOT NULL DEFAULT 'regular',
    "balance" INTEGER NOT NULL DEFAULT 0,
    "points" INTEGER NOT NULL DEFAULT 0,
    "total_spent" INTEGER NOT NULL DEFAULT 0,
    "visit_count" INTEGER NOT NULL DEFAULT 0,
    "last_visit_at" TIMESTAMP(3),
    "remark" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketing_customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_recharges" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "gift_amount" INTEGER NOT NULL DEFAULT 0,
    "type" "MarketingRechargeType" NOT NULL DEFAULT 'recharge',
    "promotion_id" INTEGER,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketing_recharges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_consumptions" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "balance_paid" INTEGER NOT NULL DEFAULT 0,
    "points_deducted" INTEGER NOT NULL DEFAULT 0,
    "pay_type" "MarketingPayType" NOT NULL DEFAULT 'cash',
    "items_summary" TEXT,
    "promotion_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketing_consumptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_promotions" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "type" "MarketingPromotionType" NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "params" JSONB NOT NULL DEFAULT '{}',
    "start_at" TIMESTAMP(3) NOT NULL,
    "end_at" TIMESTAMP(3) NOT NULL,
    "usage_count" INTEGER NOT NULL DEFAULT 0,
    "total_discount" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketing_promotions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "marketing_customers_store_id_updated_at_idx" ON "marketing_customers"("store_id", "updated_at");

-- CreateIndex
CREATE INDEX "marketing_customers_store_id_tier_updated_at_idx" ON "marketing_customers"("store_id", "tier", "updated_at");

-- CreateIndex
CREATE INDEX "marketing_customers_store_id_last_visit_at_idx" ON "marketing_customers"("store_id", "last_visit_at");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_customers_store_id_phone_key" ON "marketing_customers"("store_id", "phone");

-- CreateIndex
CREATE INDEX "marketing_recharges_store_id_created_at_idx" ON "marketing_recharges"("store_id", "created_at");

-- CreateIndex
CREATE INDEX "marketing_recharges_customer_id_created_at_idx" ON "marketing_recharges"("customer_id", "created_at");

-- CreateIndex
CREATE INDEX "marketing_recharges_store_id_type_created_at_idx" ON "marketing_recharges"("store_id", "type", "created_at");

-- CreateIndex
CREATE INDEX "marketing_consumptions_store_id_created_at_idx" ON "marketing_consumptions"("store_id", "created_at");

-- CreateIndex
CREATE INDEX "marketing_consumptions_customer_id_created_at_idx" ON "marketing_consumptions"("customer_id", "created_at");

-- CreateIndex
CREATE INDEX "marketing_promotions_store_id_enabled_start_at_idx" ON "marketing_promotions"("store_id", "enabled", "start_at");

-- CreateIndex
CREATE INDEX "marketing_promotions_store_id_created_at_idx" ON "marketing_promotions"("store_id", "created_at");

-- AddForeignKey
ALTER TABLE "marketing_customers" ADD CONSTRAINT "marketing_customers_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_recharges" ADD CONSTRAINT "marketing_recharges_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_recharges" ADD CONSTRAINT "marketing_recharges_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "marketing_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_recharges" ADD CONSTRAINT "marketing_recharges_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "marketing_promotions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_consumptions" ADD CONSTRAINT "marketing_consumptions_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_consumptions" ADD CONSTRAINT "marketing_consumptions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "marketing_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_consumptions" ADD CONSTRAINT "marketing_consumptions_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "marketing_promotions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_promotions" ADD CONSTRAINT "marketing_promotions_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
