-- 扫码点餐新订单提醒开关：门店级配置，默认关闭。
-- 商家端读写（/profit/scan-ordering/pickup-settings）：
-- - order_notice_voice_enabled：收到顾客下单时播报「您有新的订单，请注意查收」
-- - order_notice_enabled：收到顾客下单时弹出左下角新订单通知卡片

ALTER TABLE "stores"
  ADD COLUMN "order_notice_voice_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "order_notice_enabled" BOOLEAN NOT NULL DEFAULT false;
