-- AlterTable: 为 stores 表新增 member_care_enabled 字段
-- 会员护理档案仅对注册时选择「SPA/养生/美容/」模式的门店开放。
-- 该档位与 business_mode 一样在注册时确定、注册后不可切换，
-- 由 storeType 派生后落库（见 stores.utils.ts / auth-register-store.service.ts）。
-- 默认 false：历史门店一律不开放，避免存量数据意外开通。
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "member_care_enabled" BOOLEAN NOT NULL DEFAULT false;

-- ─── 历史数据回填 ──────────────────────────────────────────────
-- 存量门店的 storeType 存在 stores.profile_metadata JSONB 中（DB 为事实源），
-- 因此可在本迁移内直接按 storeType 回填，无需额外运营脚本。
-- 旧文案「养生」在本轮统一更名为「SPA/养生/美容/」，一并在此收敛。
UPDATE "stores"
SET "member_care_enabled" = true
WHERE COALESCE("profile_metadata" ->> 'storeType', '') IN ('SPA/养生/美容/', 'SPA/养生/美容', '养生');

UPDATE "stores"
SET "profile_metadata" = jsonb_set("profile_metadata", '{storeType}', '"SPA/养生/美容/"', true)
WHERE COALESCE("profile_metadata" ->> 'storeType', '') IN ('养生', 'SPA/养生/美容');
