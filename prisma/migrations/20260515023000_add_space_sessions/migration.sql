-- CreateEnum
CREATE TYPE "SpaceSessionStatus" AS ENUM ('active', 'settled');

-- CreateEnum
CREATE TYPE "SpaceBillingMode" AS ENUM ('timed', 'items', 'mixed', 'countdown');

-- CreateTable
CREATE TABLE "space_sessions" (
  "id" SERIAL NOT NULL,
  "store_id" INTEGER NOT NULL,
  "space_id" INTEGER NOT NULL,
  "reservation_id" INTEGER,
  "sale_order_id" INTEGER,
  "guest_name" TEXT,
  "guest_phone" TEXT,
  "guest_count" INTEGER,
  "start_time" TIMESTAMP(3) NOT NULL,
  "end_time" TIMESTAMP(3),
  "billing_mode" "SpaceBillingMode" NOT NULL,
  "hourly_rate" DECIMAL(12,2),
  "time_cost" DECIMAL(12,2),
  "countdown_minutes" INTEGER,
  "auto_checkout" BOOLEAN,
  "prepaid_payment_method" "SalesPaymentMethod",
  "prepaid_groupon_code" TEXT,
  "prepaid_note" TEXT,
  "prepaid_amount" DECIMAL(12,2),
  "items" JSONB NOT NULL DEFAULT '[]',
  "items_cost" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "renew_records" JSONB NOT NULL DEFAULT '[]',
  "status" "SpaceSessionStatus" NOT NULL DEFAULT 'active',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "space_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "space_sessions_reservation_id_key"
  ON "space_sessions"("reservation_id");

-- CreateIndex
CREATE UNIQUE INDEX "space_sessions_sale_order_id_key"
  ON "space_sessions"("sale_order_id");

-- CreateIndex
CREATE INDEX "space_sessions_space_id_status_start_time_idx"
  ON "space_sessions"("space_id", "status", "start_time");

-- CreateIndex
CREATE INDEX "space_sessions_store_id_status_start_time_idx"
  ON "space_sessions"("store_id", "status", "start_time");

-- CreateIndex
CREATE INDEX "space_sessions_store_id_end_time_idx"
  ON "space_sessions"("store_id", "end_time");

-- AddForeignKey
ALTER TABLE "space_sessions"
  ADD CONSTRAINT "space_sessions_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "space_sessions"
  ADD CONSTRAINT "space_sessions_space_id_fkey"
  FOREIGN KEY ("space_id") REFERENCES "spaces"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "space_sessions"
  ADD CONSTRAINT "space_sessions_reservation_id_fkey"
  FOREIGN KEY ("reservation_id") REFERENCES "space_reservations"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "space_sessions"
  ADD CONSTRAINT "space_sessions_sale_order_id_fkey"
  FOREIGN KEY ("sale_order_id") REFERENCES "sale_orders"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
