-- AlterTable: 为 sale_orders 新增团购 / 券 / 平台结算元数据列
ALTER TABLE "sale_orders" ADD COLUMN "customer_payment_method" TEXT;
ALTER TABLE "sale_orders" ADD COLUMN "groupon_code" TEXT;
ALTER TABLE "sale_orders" ADD COLUMN "groupon_platform" TEXT;
ALTER TABLE "sale_orders" ADD COLUMN "settlement_channel" TEXT;
ALTER TABLE "sale_orders" ADD COLUMN "voucher_code" TEXT;
ALTER TABLE "sale_orders" ADD COLUMN "voucher_platform" TEXT;
ALTER TABLE "sale_orders" ADD COLUMN "voucher_face_amount" INTEGER;
ALTER TABLE "sale_orders" ADD COLUMN "groupon_settlement_status" TEXT;
ALTER TABLE "sale_orders" ADD COLUMN "groupon_platform_receivable" INTEGER;
ALTER TABLE "sale_orders" ADD COLUMN "groupon_platform_settled_amount" INTEGER;
ALTER TABLE "sale_orders" ADD COLUMN "groupon_platform_fee" INTEGER;
