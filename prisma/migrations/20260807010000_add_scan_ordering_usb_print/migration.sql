-- 扫码点餐 USB 小票打印机配置：收银台顾客票 + 后厨制作单，各自可指定服务器本地 USB 打印机。
-- 打印机标识支持 Linux 设备路径（如 /dev/usb/lp0）或 CUPS 打印机名（macOS/Linux），留空时由服务自动探测。

ALTER TABLE "stores"
  ADD COLUMN "cashier_usb_printer" VARCHAR(128),
  ADD COLUMN "kitchen_usb_printer" VARCHAR(128);
