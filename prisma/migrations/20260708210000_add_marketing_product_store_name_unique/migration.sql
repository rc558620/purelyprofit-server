-- CreateIndex: 营销产品同门店名称唯一约束
CREATE UNIQUE INDEX "marketing_products_store_id_name_key" ON "marketing_products"("store_id", "name");
