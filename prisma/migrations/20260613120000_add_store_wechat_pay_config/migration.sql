-- AlterTable: 在 stores 表添加微信收款配置字段
ALTER TABLE "stores" ADD COLUMN "wechat_mch_id" TEXT;
ALTER TABLE "stores" ADD COLUMN "wechat_mch_name" TEXT;
ALTER TABLE "stores" ADD COLUMN "wechat_api_v3_key" TEXT;
ALTER TABLE "stores" ADD COLUMN "wechat_configured_at" TIMESTAMP(3);
