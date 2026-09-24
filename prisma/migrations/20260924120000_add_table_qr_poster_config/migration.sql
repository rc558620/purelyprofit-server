-- 扫码点餐桌码海报配置：门店级配置（主题色 / 标语 / 是否展示门店 Logo），
-- 商家端桌码弹窗读写（/profit/scan-ordering/table-qr-poster-config）。
-- 缺省为 NULL，读取时回退默认主题（lime），保证历史门店不受影响。

ALTER TABLE "stores"
  ADD COLUMN IF NOT EXISTS "table_qr_poster_config" JSONB;
