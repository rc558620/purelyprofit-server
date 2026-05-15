-- CreateEnum
CREATE TYPE "InventoryAdjustType" AS ENUM (
  'restock',
  'damage',
  'manual'
);

-- CreateTable
CREATE TABLE "product_categories" (
  "id" SERIAL NOT NULL,
  "store_id" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "icon" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "product_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
  "id" SERIAL NOT NULL,
  "store_id" INTEGER NOT NULL,
  "category_id" INTEGER,
  "category" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "price" DECIMAL(12,2) NOT NULL,
  "profit" DECIMAL(12,2) NOT NULL,
  "cost_price" DECIMAL(12,2),
  "unit" TEXT NOT NULL,
  "stock" INTEGER NOT NULL DEFAULT 0,
  "alert_threshold" INTEGER NOT NULL DEFAULT 10,
  "image" TEXT,
  "description" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
  "id" SERIAL NOT NULL,
  "store_id" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "contact" TEXT,
  "phone" TEXT,
  "category" TEXT,
  "note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
  "id" SERIAL NOT NULL,
  "store_id" INTEGER NOT NULL,
  "supplier_id" INTEGER,
  "operator_staff_id" INTEGER,
  "supplier_name" TEXT,
  "total_amount" DECIMAL(12,2) NOT NULL,
  "date" TIMESTAMP(3) NOT NULL,
  "note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_items" (
  "id" SERIAL NOT NULL,
  "order_id" INTEGER NOT NULL,
  "store_id" INTEGER NOT NULL,
  "product_id" INTEGER,
  "product_name" TEXT NOT NULL,
  "unit" TEXT,
  "quantity" INTEGER NOT NULL,
  "unit_price" DECIMAL(12,2) NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "purchase_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_adjustment_logs" (
  "id" SERIAL NOT NULL,
  "store_id" INTEGER NOT NULL,
  "product_id" INTEGER NOT NULL,
  "purchase_order_id" INTEGER,
  "operator_staff_id" INTEGER,
  "product_name" TEXT NOT NULL,
  "before_stock" INTEGER NOT NULL,
  "after_stock" INTEGER NOT NULL,
  "delta" INTEGER NOT NULL,
  "adjust_type" "InventoryAdjustType" NOT NULL,
  "note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "inventory_adjustment_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "product_categories_store_id_name_key" ON "product_categories"("store_id", "name");
CREATE INDEX "product_categories_store_id_updated_at_idx" ON "product_categories"("store_id", "updated_at");

CREATE UNIQUE INDEX "products_store_id_code_key" ON "products"("store_id", "code");
CREATE INDEX "products_store_id_category_updated_at_idx" ON "products"("store_id", "category", "updated_at");
CREATE INDEX "products_store_id_is_active_updated_at_idx" ON "products"("store_id", "is_active", "updated_at");
CREATE INDEX "products_category_id_updated_at_idx" ON "products"("category_id", "updated_at");

CREATE UNIQUE INDEX "suppliers_store_id_name_key" ON "suppliers"("store_id", "name");
CREATE INDEX "suppliers_store_id_updated_at_idx" ON "suppliers"("store_id", "updated_at");

CREATE INDEX "purchase_orders_store_id_date_idx" ON "purchase_orders"("store_id", "date");
CREATE INDEX "purchase_orders_supplier_id_date_idx" ON "purchase_orders"("supplier_id", "date");
CREATE INDEX "purchase_orders_operator_staff_id_created_at_idx" ON "purchase_orders"("operator_staff_id", "created_at");

CREATE INDEX "purchase_order_items_order_id_created_at_idx" ON "purchase_order_items"("order_id", "created_at");
CREATE INDEX "purchase_order_items_store_id_created_at_idx" ON "purchase_order_items"("store_id", "created_at");
CREATE INDEX "purchase_order_items_product_id_created_at_idx" ON "purchase_order_items"("product_id", "created_at");

CREATE INDEX "inventory_adjustment_logs_store_id_created_at_idx" ON "inventory_adjustment_logs"("store_id", "created_at");
CREATE INDEX "inventory_adjustment_logs_product_id_created_at_idx" ON "inventory_adjustment_logs"("product_id", "created_at");
CREATE INDEX "inventory_adjustment_logs_purchase_order_id_created_at_idx" ON "inventory_adjustment_logs"("purchase_order_id", "created_at");
CREATE INDEX "inventory_adjustment_logs_operator_staff_id_created_at_idx" ON "inventory_adjustment_logs"("operator_staff_id", "created_at");

-- AddForeignKey
ALTER TABLE "product_categories"
  ADD CONSTRAINT "product_categories_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "products"
  ADD CONSTRAINT "products_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "products"
  ADD CONSTRAINT "products_category_id_fkey"
  FOREIGN KEY ("category_id") REFERENCES "product_categories"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "suppliers"
  ADD CONSTRAINT "suppliers_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "purchase_orders"
  ADD CONSTRAINT "purchase_orders_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "purchase_orders"
  ADD CONSTRAINT "purchase_orders_supplier_id_fkey"
  FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "purchase_orders"
  ADD CONSTRAINT "purchase_orders_operator_staff_id_fkey"
  FOREIGN KEY ("operator_staff_id") REFERENCES "staffs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "purchase_order_items"
  ADD CONSTRAINT "purchase_order_items_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "purchase_orders"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "purchase_order_items"
  ADD CONSTRAINT "purchase_order_items_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "purchase_order_items"
  ADD CONSTRAINT "purchase_order_items_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "inventory_adjustment_logs"
  ADD CONSTRAINT "inventory_adjustment_logs_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "inventory_adjustment_logs"
  ADD CONSTRAINT "inventory_adjustment_logs_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "inventory_adjustment_logs"
  ADD CONSTRAINT "inventory_adjustment_logs_purchase_order_id_fkey"
  FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "inventory_adjustment_logs"
  ADD CONSTRAINT "inventory_adjustment_logs_operator_staff_id_fkey"
  FOREIGN KEY ("operator_staff_id") REFERENCES "staffs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
