-- 平台收款支付单（商家 / 门店付钱给平台）
--
-- 背景：平台会员开通/续费、新客额度充值两条链路此前没有支付环节，
-- 服务端直接把订单置为已生效（等于无条件发放会员权益与额度）。
-- 本次为它们补上真实的微信 Native 支付链路，并把「钱」抽到独立的支付单表里：
-- 支付单只管钱（下单/回调/幂等/状态机），业务结果仍写各自业务表，弱引用关联。
--
-- pay_mode 落库用于对账：测试单必须与真实单可区分，
-- 否则测试流量会污染真实对账。

-- CreateEnum
CREATE TYPE "PlatformPaymentBizType" AS ENUM ('membership', 'new_customer_quota', 'sms_recharge');

-- CreateEnum
CREATE TYPE "PlatformPaymentStatus" AS ENUM ('pending', 'paid', 'closed', 'failed');

-- CreateEnum
CREATE TYPE "PlatformPayMode" AS ENUM ('test', 'live');

-- CreateTable
CREATE TABLE "platform_payment_orders" (
    "id" SERIAL NOT NULL,
    "order_no" TEXT NOT NULL,
    "biz_type" "PlatformPaymentBizType" NOT NULL,
    "biz_order_id" TEXT,
    "store_id" INTEGER NOT NULL,
    "operator_user_id" INTEGER NOT NULL,
    "amount_fen" INTEGER NOT NULL,
    "pay_mode" "PlatformPayMode" NOT NULL,
    "status" "PlatformPaymentStatus" NOT NULL DEFAULT 'pending',
    "code_url" TEXT,
    "transaction_id" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_payment_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_payment_orders_order_no_key" ON "platform_payment_orders"("order_no");

-- CreateIndex
CREATE INDEX "platform_payment_orders_store_id_biz_type_created_at_idx" ON "platform_payment_orders"("store_id", "biz_type", "created_at");

-- CreateIndex
CREATE INDEX "platform_payment_orders_store_id_status_idx" ON "platform_payment_orders"("store_id", "status");

-- CreateIndex
CREATE INDEX "platform_payment_orders_pay_mode_created_at_idx" ON "platform_payment_orders"("pay_mode", "created_at");

-- 建表迁移，无需锁表处理；updated_at 由 Prisma 客户端始终写入，
-- 手工 SQL 插入数据时需显式提供该列。
