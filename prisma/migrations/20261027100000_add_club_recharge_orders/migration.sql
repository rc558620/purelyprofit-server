-- purelyClub 会员充值订单落库：为充值落账提供 DB 级幂等事实源与对账字段。
-- 背景：此前充值订单只存 Redis 草稿（TTL 2 小时），Redis 重启 / 淘汰 / 过期后
-- 微信回调取不到订单，会出现「用户已付款、余额不到账且无法补单」的资金事故。

-- CreateEnum
CREATE TYPE "ClubRechargeOrderStatus" AS ENUM ('pending', 'paid', 'failed', 'cancelled', 'expired');

-- AlterTable: 充值流水补充订单号与微信流水号（幂等兜底 + 对账）
ALTER TABLE "marketing_recharges"
  ADD COLUMN "order_no" TEXT,
  ADD COLUMN "transaction_id" TEXT;

-- CreateTable: 会员充值订单
CREATE TABLE "club_recharge_orders" (
    "id" SERIAL NOT NULL,
    "order_no" TEXT NOT NULL,
    "store_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "customer_id" INTEGER,
    "package_id" TEXT,
    "promotion_id" INTEGER,
    "amount_fen" INTEGER NOT NULL,
    "custom_amount_fen" INTEGER,
    "bonus_amount_fen" INTEGER NOT NULL DEFAULT 0,
    "payment_channel" TEXT NOT NULL DEFAULT 'wechat',
    "transaction_id" TEXT,
    "status" "ClubRechargeOrderStatus" NOT NULL DEFAULT 'pending',
    "payment_confirmation_source" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "paid_at" TIMESTAMP(3),
    "callback_received_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "club_recharge_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: 业务订单号唯一（微信 out_trade_no）
CREATE UNIQUE INDEX "club_recharge_orders_order_no_key" ON "club_recharge_orders"("order_no");

-- CreateIndex: 微信流水号唯一（同一笔微信支付只允许绑定一个充值订单）
CREATE UNIQUE INDEX "uq_club_recharge_orders_transaction" ON "club_recharge_orders"("transaction_id") WHERE "transaction_id" IS NOT NULL;

-- CreateIndex: 门店维度列表 / 对账查询
CREATE INDEX "club_recharge_orders_store_id_status_created_at_idx" ON "club_recharge_orders"("store_id", "status", "created_at" DESC);

-- CreateIndex: 用户维度列表查询
CREATE INDEX "club_recharge_orders_user_id_status_created_at_idx" ON "club_recharge_orders"("user_id", "status", "created_at" DESC);

-- CreateIndex: 活动维度统计
CREATE INDEX "club_recharge_orders_promotion_id_idx" ON "club_recharge_orders"("promotion_id");

-- CreateIndex: 充值流水按订单号唯一，DB 层兜底防重复落账（历史数据 order_no 为空不受影响）
CREATE UNIQUE INDEX "uq_marketing_recharges_order_no" ON "marketing_recharges"("order_no") WHERE "order_no" IS NOT NULL;

-- CreateIndex: 按微信流水号追溯充值流水（对账）
CREATE INDEX "marketing_recharges_transaction_id_idx" ON "marketing_recharges"("transaction_id") WHERE "transaction_id" IS NOT NULL;
