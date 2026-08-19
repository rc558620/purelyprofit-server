-- 空间消费小票打印配置：general 业态门店独立于扫码点餐（cashier/kitchen）的打印通道
ALTER TABLE "stores" ADD COLUMN "space_print_channel" TEXT NOT NULL DEFAULT 'browser';
ALTER TABLE "stores" ADD COLUMN "space_cloud_printer_sn" TEXT;
ALTER TABLE "stores" ADD COLUMN "space_usb_printer" TEXT;
