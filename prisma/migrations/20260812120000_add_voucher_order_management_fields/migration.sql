-- 团购券订单商家端管理：新增商品分类名快照与确认/拒绝记录字段
ALTER TABLE "club_voucher_orders" ADD COLUMN "category_name" TEXT;
ALTER TABLE "club_voucher_orders" ADD COLUMN "confirmed_at" TIMESTAMP(3);
ALTER TABLE "club_voucher_orders" ADD COLUMN "confirmed_by_staff_name" TEXT;
ALTER TABLE "club_voucher_orders" ADD COLUMN "rejected_at" TIMESTAMP(3);
ALTER TABLE "club_voucher_orders" ADD COLUMN "rejected_by_staff_name" TEXT;

-- 团购券新订单语音播报开关（默认关闭，商家端修改）
ALTER TABLE "stores" ADD COLUMN "voucher_order_voice_enabled" BOOLEAN NOT NULL DEFAULT false;
