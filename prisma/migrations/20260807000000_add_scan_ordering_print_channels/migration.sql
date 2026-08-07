-- 扫码点餐打印通道配置：收银台顾客票 + 后厨制作单，各自支持浏览器打印 / 飞鹅云打印 / 关闭。

-- 1. 收银台顾客票打印通道（默认 browser，兼容现状）
ALTER TABLE "stores"
  ADD COLUMN "cashier_print_channel" VARCHAR(16) NOT NULL DEFAULT 'browser';

-- 2. 后厨制作单打印通道（默认 off，未启用）
ALTER TABLE "stores"
  ADD COLUMN "kitchen_print_channel" VARCHAR(16) NOT NULL DEFAULT 'off';

-- 3. 收银台 / 后厨飞鹅云打印机 SN（对应通道为 cloud 时必填）
ALTER TABLE "stores"
  ADD COLUMN "cashier_cloud_printer_sn" VARCHAR(64),
  ADD COLUMN "kitchen_cloud_printer_sn" VARCHAR(64);
