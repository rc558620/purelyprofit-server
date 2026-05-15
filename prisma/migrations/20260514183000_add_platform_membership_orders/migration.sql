-- CreateEnum
CREATE TYPE "MembershipPlanCycle" AS ENUM (
  'monthly',
  'quarterly',
  'yearly'
);

-- CreateEnum
CREATE TYPE "MembershipOrderStatus" AS ENUM (
  'pending',
  'paid',
  'failed',
  'refunded'
);

-- CreateEnum
CREATE TYPE "MembershipPaymentChannel" AS ENUM (
  'wechat'
);

-- CreateTable
CREATE TABLE "store_membership_profiles" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "current_plan_id" "MembershipPlanCycle",
    "starts_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "total_points" INTEGER NOT NULL DEFAULT 0,
    "available_points" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_membership_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_membership_orders" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "profile_id" INTEGER NOT NULL,
    "plan_id" "MembershipPlanCycle" NOT NULL,
    "plan_name" TEXT NOT NULL,
    "original_amount" INTEGER NOT NULL,
    "points_deducted" INTEGER NOT NULL DEFAULT 0,
    "points_used" INTEGER NOT NULL DEFAULT 0,
    "bean_deducted" INTEGER NOT NULL DEFAULT 0,
    "beans_used" INTEGER NOT NULL DEFAULT 0,
    "amount" INTEGER NOT NULL,
    "status" "MembershipOrderStatus" NOT NULL DEFAULT 'paid',
    "payment_channel" "MembershipPaymentChannel" NOT NULL DEFAULT 'wechat',
    "payment_order_id" TEXT,
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_membership_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "store_membership_profiles_store_id_key" ON "store_membership_profiles"("store_id");

-- CreateIndex
CREATE INDEX "store_membership_profiles_expires_at_idx"
  ON "store_membership_profiles"("expires_at");

-- CreateIndex
CREATE INDEX "store_membership_orders_store_id_created_at_idx"
  ON "store_membership_orders"("store_id", "created_at");

-- CreateIndex
CREATE INDEX "store_membership_orders_profile_id_created_at_idx"
  ON "store_membership_orders"("profile_id", "created_at");

-- CreateIndex
CREATE INDEX "store_membership_orders_status_created_at_idx"
  ON "store_membership_orders"("status", "created_at");

-- AddForeignKey
ALTER TABLE "store_membership_profiles"
  ADD CONSTRAINT "store_membership_profiles_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_membership_orders"
  ADD CONSTRAINT "store_membership_orders_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_membership_orders"
  ADD CONSTRAINT "store_membership_orders_profile_id_fkey"
  FOREIGN KEY ("profile_id") REFERENCES "store_membership_profiles"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
