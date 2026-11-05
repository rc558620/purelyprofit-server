-- 回滚：撤销营销商品的「限时团购标签」开关列

ALTER TABLE "marketing_products"
    DROP COLUMN IF EXISTS "show_group_buy_tag";
