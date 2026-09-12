-- AlterTable
-- 空间账单明细补充规格维度：
-- - spec_signature 参与合并键，保证同商品不同规格分行、不被静默合并
-- - spec_names 供账单/小票/详情展示规格名
ALTER TABLE "space_session_items"
    ADD COLUMN "spec_signature" CHAR(64),
    ADD COLUMN "spec_names" JSONB;

-- AlterTable
-- 自助下单订单行补充规格签名：同时参与「合并键」与「幂等指纹」，
-- 否则同商品不同规格会被合并成一行，且重复提交会命中错误的幂等记录。
ALTER TABLE "self_order_items" ADD COLUMN "spec_signature" CHAR(64);

-- CreateTable
-- 规格快照（照抄 scan_order_item_specs）：
-- 规格选项会被 syncSpecifications 物理删除重建，必须落快照才能支撑退款与对账追溯。
CREATE TABLE "self_order_item_specs" (
    "id" SERIAL NOT NULL,
    "order_item_id" INTEGER NOT NULL,
    "spec_option_id" INTEGER NOT NULL,
    "spec_option_name_snapshot" TEXT NOT NULL,
    "extra_price_snapshot" INTEGER NOT NULL,

    CONSTRAINT "self_order_item_specs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "self_order_item_specs_order_item_id_id_idx" ON "self_order_item_specs"("order_item_id", "id");

-- AddForeignKey
ALTER TABLE "self_order_item_specs" ADD CONSTRAINT "self_order_item_specs_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "self_order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
