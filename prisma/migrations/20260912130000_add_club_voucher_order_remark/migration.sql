-- AlterTable
-- 团购券订单补充下单备注（purelyClub 用户购买时填写），
-- 供 purelyProfit 商家端「您有新的订单」通知与订单详情展示。
ALTER TABLE "club_voucher_orders" ADD COLUMN "remark" VARCHAR(200);
