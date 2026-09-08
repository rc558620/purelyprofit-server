-- AlterTable
-- 自助下单商品行补充支付渠道（balance=储值余额 / wechat=微信支付），
-- 供 purelyProfit 空间账单明细按「余额/微信」展示已在线支付来源。
ALTER TABLE "space_session_items" ADD COLUMN     "source_channel" VARCHAR(32);
