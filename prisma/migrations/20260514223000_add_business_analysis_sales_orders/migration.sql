-- AlterEnum
ALTER TYPE "FinanceCashFlowCategory" ADD VALUE IF NOT EXISTS 'utilities';

-- CreateEnum
CREATE TYPE "SalesPaymentMethod" AS ENUM (
  'cash',
  'wechat',
  'alipay',
  'card'
);

-- CreateEnum
CREATE TYPE "SalesCalcMode" AS ENUM (
  'profit',
  'business'
);

-- CreateTable
CREATE TABLE "sale_orders" (
  "id" SERIAL NOT NULL,
  "store_id" INTEGER NOT NULL,
  "operator_staff_id" INTEGER,
  "order_no" TEXT NOT NULL,
  "total_revenue" DECIMAL(12, 2) NOT NULL,
  "total_profit" DECIMAL(12, 2) NOT NULL,
  "total_quantity" INTEGER NOT NULL,
  "payment_method" "SalesPaymentMethod" NOT NULL,
  "calc_mode" "SalesCalcMode" NOT NULL DEFAULT 'business',
  "note" TEXT,
  "date" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "sale_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_order_items" (
  "id" SERIAL NOT NULL,
  "order_id" INTEGER NOT NULL,
  "store_id" INTEGER NOT NULL,
  "product_id" INTEGER,
  "product_name" TEXT NOT NULL,
  "category_name" TEXT NOT NULL,
  "sale_price" DECIMAL(12, 2) NOT NULL,
  "profit" DECIMAL(12, 2) NOT NULL,
  "quantity" INTEGER NOT NULL,
  "image" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "sale_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sale_orders_store_id_order_no_key"
  ON "sale_orders"("store_id", "order_no");

-- CreateIndex
CREATE INDEX "sale_orders_store_id_date_idx"
  ON "sale_orders"("store_id", "date");

-- CreateIndex
CREATE INDEX "sale_orders_operator_staff_id_created_at_idx"
  ON "sale_orders"("operator_staff_id", "created_at");

-- CreateIndex
CREATE INDEX "sale_order_items_order_id_created_at_idx"
  ON "sale_order_items"("order_id", "created_at");

-- CreateIndex
CREATE INDEX "sale_order_items_store_id_created_at_idx"
  ON "sale_order_items"("store_id", "created_at");

-- CreateIndex
CREATE INDEX "sale_order_items_product_id_created_at_idx"
  ON "sale_order_items"("product_id", "created_at");

-- CreateIndex
CREATE INDEX "sale_order_items_category_name_created_at_idx"
  ON "sale_order_items"("category_name", "created_at");

-- AddForeignKey
ALTER TABLE "sale_orders"
  ADD CONSTRAINT "sale_orders_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_orders"
  ADD CONSTRAINT "sale_orders_operator_staff_id_fkey"
  FOREIGN KEY ("operator_staff_id") REFERENCES "staffs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_order_items"
  ADD CONSTRAINT "sale_order_items_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "sale_orders"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_order_items"
  ADD CONSTRAINT "sale_order_items_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_order_items"
  ADD CONSTRAINT "sale_order_items_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
