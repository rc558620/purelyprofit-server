-- 年度会员有效期改为自然年 365 天
--
-- 背景：
-- buildPlanExpiryAt 原按 durationMonths × 30 计算有效期，年卡 12 × 30 = 360 天，
-- 比自然年少 5 天。代码已改为优先 validDays 精确天数（未配置时退回 30 天/月口径）。
-- 本迁移为存量 yearly 套餐配置补 valid_days = 365。
--
-- 幂等：仅当 valid_days 为空或不等于 365 时更新。

UPDATE membership_plan_settings
   SET valid_days = 365
 WHERE plan_id = 'yearly'
   AND (valid_days IS NULL OR valid_days <> 365);
