-- 扫码点餐小票打印开关：门店级配置，控制订单详情是否允许打印小票（默认关闭）。

ALTER TABLE "stores"
  ADD COLUMN "receipt_print_enabled" BOOLEAN NOT NULL DEFAULT false;
