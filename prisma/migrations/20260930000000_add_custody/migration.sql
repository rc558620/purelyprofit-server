-- CreateEnum
CREATE TYPE "CustodyStatus" AS ENUM ('draft', 'stored', 'finished', 'expired', 'void');

-- CreateEnum
CREATE TYPE "CustodyStockMode" AS ENUM ('sold', 'frozen');

-- CreateTable
CREATE TABLE "custody_orders" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "order_no" VARCHAR(32) NOT NULL,
    "member_id" INTEGER,
    "member_name_snapshot" VARCHAR(50),
    "member_phone_snapshot" VARCHAR(20),
    "product_id" INTEGER,
    "product_name" VARCHAR(100) NOT NULL,
    "spec_name" VARCHAR(50),
    "unit" VARCHAR(10) NOT NULL,
    "total_qty" INTEGER NOT NULL,
    "remaining_qty" INTEGER NOT NULL,
    "stock_mode" "CustodyStockMode" NOT NULL DEFAULT 'sold',
    "location" VARCHAR(50),
    "stored_at" TIMESTAMP(3) NOT NULL,
    "expire_at" TIMESTAMP(3),
    "status" "CustodyStatus" NOT NULL DEFAULT 'draft',
    "source_order_id" INTEGER,
    "created_by_staff_id" INTEGER,
    "created_by_name_snapshot" VARCHAR(50),
    "voided_by_staff_id" INTEGER,
    "voided_at" TIMESTAMP(3),
    "void_reason" VARCHAR(100),
    "idempotency_key" VARCHAR(64),
    "note" VARCHAR(200),
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custody_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custody_pickups" (
    "id" SERIAL NOT NULL,
    "custody_order_id" INTEGER NOT NULL,
    "store_id" INTEGER NOT NULL,
    "qty" INTEGER NOT NULL,
    "operator_staff_id" INTEGER,
    "operator_name_snapshot" VARCHAR(50),
    "related_order_id" INTEGER,
    "picked_at" TIMESTAMP(3) NOT NULL,
    "idempotency_key" VARCHAR(64),
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custody_pickups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custody_settings" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "stock_mode" "CustodyStockMode" NOT NULL DEFAULT 'sold',
    "default_expire_days" INTEGER,
    "allow_cross_store_pickup" BOOLEAN NOT NULL DEFAULT false,
    "require_member_confirm" BOOLEAN NOT NULL DEFAULT true,
    "unit_options" JSONB,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custody_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_custody_orders_store_status_created" ON "custody_orders"("store_id", "status", "created_at" DESC) WHERE (deleted_at IS NULL);

-- CreateIndex
CREATE INDEX "idx_custody_orders_store_member_status" ON "custody_orders"("store_id", "member_id", "status") WHERE (deleted_at IS NULL);

-- CreateIndex
CREATE INDEX "idx_custody_orders_store_product_status" ON "custody_orders"("store_id", "product_id", "status") WHERE ((deleted_at IS NULL) AND (product_id IS NOT NULL));

-- CreateIndex
CREATE INDEX "idx_custody_orders_store_expire" ON "custody_orders"("store_id", "expire_at") WHERE ((status = 'stored'::"CustodyStatus") AND (deleted_at IS NULL));

-- CreateIndex
CREATE UNIQUE INDEX "uq_custody_orders_store_order_no" ON "custody_orders"("store_id", "order_no");

-- CreateIndex
CREATE UNIQUE INDEX "uq_custody_orders_store_idempotency_key" ON "custody_orders"("store_id", "idempotency_key") WHERE ((deleted_at IS NULL) AND (idempotency_key IS NOT NULL));

-- CreateIndex
CREATE INDEX "idx_custody_pickups_order_picked" ON "custody_pickups"("custody_order_id", "picked_at" DESC) WHERE (deleted_at IS NULL);

-- CreateIndex
CREATE INDEX "custody_pickups_store_id_picked_at_idx" ON "custody_pickups"("store_id", "picked_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "uq_custody_pickups_order_idempotency" ON "custody_pickups"("custody_order_id", "idempotency_key") WHERE ((deleted_at IS NULL) AND (idempotency_key IS NOT NULL));

-- CreateIndex
CREATE UNIQUE INDEX "custody_settings_store_id_key" ON "custody_settings"("store_id");

-- AddForeignKey
ALTER TABLE "custody_pickups" ADD CONSTRAINT "custody_pickups_custody_order_id_fkey" FOREIGN KEY ("custody_order_id") REFERENCES "custody_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterEnum
ALTER TYPE "InventoryAdjustType" ADD VALUE 'custody_pickup';
