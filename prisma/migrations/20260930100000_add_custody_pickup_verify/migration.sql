-- AlterTable
-- 取出核验配置：默认关闭，不改变既有门店行为
ALTER TABLE "custody_settings"
    ADD COLUMN "pickup_phone_verify_enabled" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "pickup_phone_verify_threshold" INTEGER;
