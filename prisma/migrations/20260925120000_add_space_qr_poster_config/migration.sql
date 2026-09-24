-- 空间二维码海报配置：门店级配置（主题色 / 标语 / 是否展示门店 Logo），
-- 空间管理二维码弹窗读写（/spaces/qr-poster）。
-- 缺省为 NULL，读取时回退空间码默认主题与标语，保证历史门店不受影响。

ALTER TABLE "stores"
  ADD COLUMN IF NOT EXISTS "space_qr_poster_config" JSONB;
