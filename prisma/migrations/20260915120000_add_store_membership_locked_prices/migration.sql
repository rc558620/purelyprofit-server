-- CreateEnum
CREATE TYPE "StoreMembershipLockedPriceSource" AS ENUM (
  'purchase',
  'admin'
);

-- CreateTable
CREATE TABLE "store_membership_locked_prices" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "plan_id" "MembershipPlanCycle" NOT NULL,
    "price" INTEGER NOT NULL,
    "source" "StoreMembershipLockedPriceSource" NOT NULL DEFAULT 'purchase',
    "locked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_membership_locked_prices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "store_membership_locked_prices_store_id_plan_id_key"
  ON "store_membership_locked_prices"("store_id", "plan_id");

-- AddForeignKey
ALTER TABLE "store_membership_locked_prices"
  ADD CONSTRAINT "store_membership_locked_prices_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- 历史回填：按每个门店每个套餐「最早一笔已支付订单」的下单时列表价锁定首购价。
-- original_amount 是下单时刻的列表价快照（未扣积分/纯利豆），与锁价语义一致。
INSERT INTO "store_membership_locked_prices" ("store_id", "plan_id", "price", "source", "locked_at", "created_at", "updated_at")
SELECT DISTINCT ON (orders."store_id", orders."plan_id")
       orders."store_id",
       orders."plan_id",
       orders."original_amount",
       'purchase'::"StoreMembershipLockedPriceSource",
       orders."created_at",
       NOW(),
       NOW()
  FROM "store_membership_orders" orders
 WHERE orders."status" = 'paid'
 ORDER BY orders."store_id", orders."plan_id", orders."created_at" ASC
ON CONFLICT ("store_id", "plan_id") DO NOTHING;
