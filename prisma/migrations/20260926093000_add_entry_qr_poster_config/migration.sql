-- 进店二维码海报配置：门店级配置（主题色 / 标语 / 是否展示门店 Logo），
-- 营销中心进店码弹窗读写（/marketing/qr-poster）。
-- 缺省为 NULL，读取时回退进店码默认主题与标语，保证历史门店不受影响。

ALTER TABLE "stores"
  ADD COLUMN IF NOT EXISTS "entry_qr_poster_config" JSONB;
