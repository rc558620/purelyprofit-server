-- 群发短信：账户 / 钱包流水 / 群发任务 / 收件人 / 充值订单
-- CreateEnum
CREATE TYPE "SmsWalletLogType" AS ENUM ('recharge', 'consume', 'refund', 'grant', 'admin_adjust');

-- CreateEnum
CREATE TYPE "SmsBroadcastTaskStatus" AS ENUM ('pending', 'sending', 'sent', 'partial_failed', 'failed');

-- CreateEnum
CREATE TYPE "SmsBroadcastRecipientStatus" AS ENUM ('pending', 'success', 'failed');

-- CreateEnum
CREATE TYPE "SmsRechargeOrderStatus" AS ENUM ('pending', 'paid', 'closed', 'failed');

-- CreateTable
CREATE TABLE "store_sms_accounts" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "balance_fen" INTEGER NOT NULL DEFAULT 0,
    "total_recharged_fen" INTEGER NOT NULL DEFAULT 0,
    "total_consumed_fen" INTEGER NOT NULL DEFAULT 0,
    "sent_sms_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_sms_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sms_wallet_logs" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "type" "SmsWalletLogType" NOT NULL,
    "change_fen" INTEGER NOT NULL,
    "balance_after_fen" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "order_no" TEXT,
    "broadcast_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sms_wallet_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sms_broadcast_tasks" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "broadcast_id" TEXT NOT NULL,
    "operator_staff_id" INTEGER,
    "content" TEXT NOT NULL,
    "status" "SmsBroadcastTaskStatus" NOT NULL DEFAULT 'pending',
    "recipient_count" INTEGER NOT NULL DEFAULT 0,
    "valid_mobile_count" INTEGER NOT NULL DEFAULT 0,
    "sms_segments" INTEGER NOT NULL DEFAULT 0,
    "success_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "unit_price_fen" INTEGER NOT NULL DEFAULT 0,
    "charged_amount_fen" INTEGER NOT NULL DEFAULT 0,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sms_broadcast_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sms_broadcast_recipients" (
    "id" SERIAL NOT NULL,
    "task_id" INTEGER NOT NULL,
    "customer_id" INTEGER,
    "phone" TEXT NOT NULL,
    "status" "SmsBroadcastRecipientStatus" NOT NULL DEFAULT 'pending',
    "provider_code" TEXT,
    "provider_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sms_broadcast_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sms_recharge_orders" (
    "id" SERIAL NOT NULL,
    "order_no" TEXT NOT NULL,
    "store_id" INTEGER NOT NULL,
    "amount_fen" INTEGER NOT NULL,
    "status" "SmsRechargeOrderStatus" NOT NULL DEFAULT 'pending',
    "code_url" TEXT,
    "transaction_id" TEXT,
    "paid_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sms_recharge_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "store_sms_accounts_store_id_key" ON "store_sms_accounts"("store_id");

-- CreateIndex
CREATE INDEX "sms_wallet_logs_store_id_created_at_idx" ON "sms_wallet_logs"("store_id", "created_at");

-- CreateIndex
CREATE INDEX "sms_wallet_logs_store_id_type_created_at_idx" ON "sms_wallet_logs"("store_id", "type", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "sms_broadcast_tasks_broadcast_id_key" ON "sms_broadcast_tasks"("broadcast_id");

-- CreateIndex
CREATE UNIQUE INDEX "sms_broadcast_tasks_idempotency_key_key" ON "sms_broadcast_tasks"("idempotency_key");

-- CreateIndex
CREATE INDEX "sms_broadcast_tasks_store_id_created_at_idx" ON "sms_broadcast_tasks"("store_id", "created_at");

-- CreateIndex
CREATE INDEX "sms_broadcast_tasks_store_id_status_created_at_idx" ON "sms_broadcast_tasks"("store_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "sms_broadcast_recipients_task_id_status_idx" ON "sms_broadcast_recipients"("task_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "sms_recharge_orders_order_no_key" ON "sms_recharge_orders"("order_no");

-- CreateIndex
CREATE INDEX "sms_recharge_orders_store_id_status_idx" ON "sms_recharge_orders"("store_id", "status");

-- CreateIndex
CREATE INDEX "sms_recharge_orders_store_id_created_at_idx" ON "sms_recharge_orders"("store_id", "created_at");
