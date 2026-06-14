-- Fix: 将误设为 points_2x 的折扣活动类型修正为 discount
-- 背景："全场8折"等折扣活动被错误地创建为 points_2x 类型，
--       而定价引擎仅加载 first_order_discount / discount / reduce，
--       导致这些折扣活动从未参与价格计算。
-- 条件：params 中包含 rate 或 discountRate 字段的 points_2x 活动，
--       其语义为折扣而非双倍积分，应归类为 discount。

UPDATE marketing_promotions
SET type = 'discount'::"MarketingPromotionType"
WHERE type = 'points_2x'
  AND (
    params ? 'rate'
    OR params ? 'discountRate'
  );
