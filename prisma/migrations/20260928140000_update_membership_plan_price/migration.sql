-- 调整会员套餐默认实付价：月度 42 元 / 季度 108 元 / 年度 398 元
--
-- 背景：
-- DEFAULT_MEMBERSHIP_PLAN_SETTINGS 的 upsert 用的是 `update: {}`，
-- 已存在的存量行不会被新的默认值刷新，因此必须用迁移显式 UPDATE 存量行。
--
-- 与划线原价不同，实付价是运营可在 Pulse「会员套餐配置」里自行改价的标准价，
-- 所以这里只迁移「仍停留在上一版默认价」的行：
-- 已被运营调过价的档位不动，避免迁移把线上议价/调价结果冲掉。
--
-- 永久会员（lifetime）本次不动，仍为 398 元。
-- 角标「省X元」不写死，由 resolvePlanBadge 按 original_price − price 实时计算，
-- 本次改价后自动变为 省66元 / 省190元 / 省600元。
--
-- 幂等：重复执行结果一致（第二次执行时价格已不等于旧默认值，命中 0 行）。

UPDATE "membership_plan_settings"
   SET "price" = CASE "plan_id"
         WHEN 'monthly'   THEN 4200
         WHEN 'quarterly' THEN 10800
         WHEN 'yearly'    THEN 39800
       END,
       "updated_at" = CURRENT_TIMESTAMP
 WHERE ("plan_id" = 'monthly'   AND "price" = 3800)
    OR ("plan_id" = 'quarterly' AND "price" = 9900)
    OR ("plan_id" = 'yearly'    AND "price" = 36900);
