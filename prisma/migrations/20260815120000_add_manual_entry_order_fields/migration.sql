-- 手工补录订单（录入订单）：sale_orders 扩展字段、支付方式枚举与来源枚举

-- CreateTable: 手工补录就餐方式枚举
CREATE TYPE "ManualEntryDiningMode" AS ENUM ('dineIn', 'takeaway', 'platform');

-- CreateTable: 手工补录来源渠道枚举
CREATE TYPE "ManualEntrySourceChannel" AS ENUM ('meituan', 'eleme', 'meituanVoucher', 'douyin', 'dianping', 'other');

-- AlterEnum: 为 SalesPaymentMethod 枚举新增 platform 值（平台结算）
ALTER TYPE "SalesPaymentMethod" ADD VALUE 'platform';

-- AlterTable: sale_orders 新增手工补录字段（全部可空/带默认值，兼容存量数据）
ALTER TABLE "sale_orders" ADD COLUMN "manual_entry" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "sale_orders" ADD COLUMN "dining_mode" "ManualEntryDiningMode";
ALTER TABLE "sale_orders" ADD COLUMN "source_channel" "ManualEntrySourceChannel";
ALTER TABLE "sale_orders" ADD COLUMN "external_order_no" VARCHAR(128);
ALTER TABLE "sale_orders" ADD COLUMN "guest_count" INTEGER;
ALTER TABLE "sale_orders" ADD COLUMN "customer_phone" VARCHAR(20);
ALTER TABLE "sale_orders" ADD COLUMN "dining_table_id" INTEGER;

-- CreateIndex: 手工补录订单按门店筛选与对账
CREATE INDEX "sale_orders_store_id_manual_entry_created_at_idx" ON "sale_orders"("store_id", "manual_entry", "created_at" DESC);

-- AddForeignKey: 关联扫码点餐桌台（不约束删除，桌台软删除保留历史关联）
ALTER TABLE "sale_orders" ADD CONSTRAINT "sale_orders_dining_table_id_fkey" FOREIGN KEY ("dining_table_id") REFERENCES "scan_ordering_tables"("id") ON DELETE SET NULL ON UPDATE CASCADE;
