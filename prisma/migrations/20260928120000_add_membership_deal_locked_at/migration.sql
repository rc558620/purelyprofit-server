-- 成交锁定时点：区分「真实成交快照」与「仅为承载续费价覆盖而建的占位行」。
--
-- 背景：`renewal_price_override` 与成交分量（price / sub_account_amount / source）
-- 落在同一行，导致两件事被混为一谈：
--   1. 运营先改续费价、门店后成交时，`lockPriceOnFirstDeal` 以为「行已存在 = 已成交」
--      而跳过写入，真实成交价与 purchase 来源永久丢失；
--   2. 「重置成交价」只能整行删除，会把运营议定的续费价一起销毁。
-- 本列非空即表示该行确有成交记录，上述两处都以它为准。
ALTER TABLE "store_membership_locked_prices"
  ADD COLUMN IF NOT EXISTS "deal_locked_at" TIMESTAMP(3);

-- 存量回填：历史上只有成交才会写入本表（覆盖价功能晚于成交记录存在），
-- 因此一律按「已成交」处理，回填 locked_at 保持语义连续。
-- 取舍：若已有运营用新功能改价产生的占位行，会被一并回填成已成交
-- （退化为本次修复之前的行为，不会误删价格），下次成交由 upsertDealPrice 覆盖。
UPDATE "store_membership_locked_prices"
   SET "deal_locked_at" = "locked_at"
 WHERE "deal_locked_at" IS NULL;
