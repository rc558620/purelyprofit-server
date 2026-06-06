-- CreateTable
CREATE TABLE "marketing_product_categories" (
  "id" SERIAL NOT NULL,
  "store_id" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "icon" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "marketing_product_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_products" (
  "id" SERIAL NOT NULL,
  "store_id" INTEGER NOT NULL,
  "category_id" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "price" INTEGER NOT NULL,
  "original_price" INTEGER,
  "image" TEXT,
  "description" TEXT,
  "duration_minutes" INTEGER,
  "person_count" INTEGER,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "marketing_products_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "marketing_product_categories_store_id_name_key"
  ON "marketing_product_categories"("store_id", "name");

CREATE INDEX "marketing_product_categories_store_id_updated_at_idx"
  ON "marketing_product_categories"("store_id", "updated_at");

CREATE INDEX "marketing_products_store_id_created_at_idx"
  ON "marketing_products"("store_id", "created_at");

CREATE INDEX "marketing_products_store_id_category_id_created_at_idx"
  ON "marketing_products"("store_id", "category_id", "created_at");

CREATE INDEX "marketing_products_store_id_is_active_updated_at_idx"
  ON "marketing_products"("store_id", "is_active", "updated_at");

CREATE INDEX "marketing_products_store_id_name_idx"
  ON "marketing_products"("store_id", "name");

CREATE INDEX "marketing_products_store_id_price_idx"
  ON "marketing_products"("store_id", "price");

-- AddForeignKey
ALTER TABLE "marketing_product_categories"
  ADD CONSTRAINT "marketing_product_categories_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "marketing_products"
  ADD CONSTRAINT "marketing_products_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "marketing_products"
  ADD CONSTRAINT "marketing_products_category_id_fkey"
  FOREIGN KEY ("category_id") REFERENCES "marketing_product_categories"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
