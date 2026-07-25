-- AlterTable: 为 scan_ordering_menu_products 表新增 product_id 字段
ALTER TABLE "scan_ordering_menu_products" ADD COLUMN "product_id" INTEGER;

-- CreateIndex: 为 product_id 创建索引，用于按普通商品 ID 查询扫码菜单关联
CREATE INDEX "scan_ordering_menu_products_product_id_idx"
  ON "scan_ordering_menu_products"("product_id");

-- AddForeignKey: 添加 product_id 到 products 表的外键
-- onDelete: SetNull —— 普通商品删除时，扫码菜单商品的 product_id 置空，不级联删除菜单商品
ALTER TABLE "scan_ordering_menu_products"
  ADD CONSTRAINT "scan_ordering_menu_products_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
