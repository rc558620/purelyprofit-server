-- 营销商品新增「是否展示限时团购标签」开关（仅团购券商品 type=voucher 生效）。
-- 默认 true：存量团购券商品在 C 端的「限时团购」标签保持现状，由商家按需关闭。

-- AlterTable
ALTER TABLE "marketing_products"
ADD COLUMN "show_group_buy_tag" BOOLEAN NOT NULL DEFAULT true;
