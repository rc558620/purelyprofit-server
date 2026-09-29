-- 调整会员套餐划线原价：月度 108 元 / 季度 298 元 / 年度 998 元
--
-- 背景：
-- 划线原价只存在于 membership_plan_settings.original_price，管理端（Pulse 会员套餐配置）
-- 只能改实付价 price 与有效期 validDays，改不了 original_price；
-- 而 DEFAULT_MEMBERSHIP_PLAN_SETTINGS 的 upsert 用的是 `update: {}`，
-- 已存在的存量行不会被默认值刷新。因此必须用迁移显式 UPDATE 存量行。
--
-- 卡片角标「省X元」不再写死，由 resolvePlanBadge 按
-- original_price − price 实时计算，调价后自动同步。
--
-- 幂等：重复执行结果一致。
-- 永久会员（lifetime）无划线原价概念，不参与本次调整。

UPDATE "membership_plan_settings"
   SET "original_price" = CASE "plan_id"
         WHEN 'monthly'   THEN 10800
         WHEN 'quarterly' THEN 29800
         WHEN 'yearly'    THEN 99800
       END,
       "updated_at" = CURRENT_TIMESTAMP
 WHERE "plan_id" IN ('monthly', 'quarterly', 'yearly');
