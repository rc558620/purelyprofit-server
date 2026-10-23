-- 统一会员护理档案门店类型文案：去掉结尾斜杠，「SPA/养生/美容/」→「SPA/养生/美容」
--
-- 背景：上一迁移 20261023100000_add_store_member_care_enabled 曾把无斜杠写法
-- 收敛为带斜杠的「SPA/养生/美容/」。本轮口径翻转（尾斜杠不参与展示），
-- 需把存量数据反向统一，否则前端门店设置页回显值会与 STORE_TYPE_OPTIONS 不一致。
--
-- 功能开关不受影响：前后端 isMemberCareStoreType 均做了 trim + 去尾斜杠归一化，
-- 本迁移只是让库内数据与展示口径一致。

-- 1. 旧文案「养生」与带斜杠写法统一改写为新文案
UPDATE "stores"
SET "profile_metadata" = jsonb_set("profile_metadata", '{storeType}', '"SPA/养生/美容"', true)
WHERE COALESCE("profile_metadata" ->> 'storeType', '') IN ('SPA/养生/美容/', '养生');

-- 2. 同步档位开关：仅确认是该模式的门店才开启，避免误开
UPDATE "stores"
SET "member_care_enabled" = true
WHERE COALESCE("profile_metadata" ->> 'storeType', '') = 'SPA/养生/美容';
