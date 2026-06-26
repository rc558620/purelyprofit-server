-- Step 3: 创建 StoreWechatPayConfig 表实现敏感配置独立化（0.5）
-- 将 Store 表中的微信支付配置迁移到独立表，并实现字段级加密

CREATE TABLE "store_wechat_pay_configs" (
  "id"              SERIAL       PRIMARY KEY,
  "store_id"        INT          NOT NULL UNIQUE,
  "mch_id"          VARCHAR(32)  NOT NULL,
  "mch_name"        VARCHAR(255) NOT NULL,
  "api_v3_key_enc"  TEXT         NOT NULL, -- AES-256-GCM 加密后的 API v3 密钥
  "configured_at"   TIMESTAMPTZ  NOT NULL,
  "created_at"      TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "store_wechat_pay_configs_store_id_fkey" FOREIGN KEY ("store_id")
    REFERENCES "stores"("id") ON DELETE CASCADE
);

CREATE INDEX "store_wechat_pay_configs_mch_id_idx" ON "store_wechat_pay_configs"("mch_id");

-- 数据迁移：将 Store 表中的现有微信支付配置迁移到新表
-- 注意：由于加密密钥还未在环境变量中配置，此步骤先将明文存储到 api_v3_key_enc
-- 生产部署前需要运行独立加密脚本完成真正的加密迁移

INSERT INTO "store_wechat_pay_configs" ("store_id", "mch_id", "mch_name", "api_v3_key_enc", "configured_at")
SELECT 
  "id" AS "store_id",
  "wechat_mch_id" AS "mch_id",
  "wechat_mch_name" AS "mch_name",
  COALESCE("wechat_api_v3_key", '') AS "api_v3_key_enc", -- 暂存明文，后续需加密
  COALESCE("wechat_configured_at", CURRENT_TIMESTAMP) AS "configured_at"
FROM "stores"
WHERE 
  "wechat_mch_id" IS NOT NULL 
  AND "wechat_mch_name" IS NOT NULL
  AND "deleted_at" IS NULL;

-- 保留 Store 表的旧字段（标记为 @deprecated），不删除以支持平滑迁移
-- 生产环境稳定后再通过后续迁移删除这些字段
