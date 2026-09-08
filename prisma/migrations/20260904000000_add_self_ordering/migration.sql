-- CreateEnum
CREATE TYPE "SelfOrderStatus" AS ENUM ('pending_payment', 'paid', 'cancelled');

-- CreateEnum
CREATE TYPE "SelfOrderPaymentStatus" AS ENUM ('unpaid', 'paid', 'refunding', 'refunded');

-- AlterTable
ALTER TABLE "space_session_items" ADD COLUMN     "source_order_item_id" INTEGER,
ADD COLUMN     "source_order_no" VARCHAR(64),
ADD COLUMN     "source_type" VARCHAR(32);

-- CreateTable
CREATE TABLE "self_orders" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "order_no" VARCHAR(64) NOT NULL,
    "session_id" INTEGER NOT NULL,
    "space_id" INTEGER NOT NULL,
    "club_user_id" INTEGER NOT NULL,
    "remark" VARCHAR(500),
    "idempotency_key" VARCHAR(128),
    "currency" CHAR(3) NOT NULL DEFAULT 'CNY',
    "item_total_amount" INTEGER NOT NULL DEFAULT 0,
    "payable_amount" INTEGER NOT NULL DEFAULT 0,
    "paid_amount" INTEGER NOT NULL DEFAULT 0,
    "status" "SelfOrderStatus" NOT NULL DEFAULT 'pending_payment',
    "payment_status" "SelfOrderPaymentStatus" NOT NULL DEFAULT 'unpaid',
    "version" INTEGER NOT NULL DEFAULT 0,
    "paid_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "self_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "self_order_items" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "product_id" VARCHAR(64) NOT NULL,
    "product_name" VARCHAR(200) NOT NULL,
    "category_name" VARCHAR(100),
    "sale_price" INTEGER NOT NULL,
    "cost_price" INTEGER NOT NULL DEFAULT 0,
    "quantity" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "self_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "self_order_payment_attempts" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "payment_channel" VARCHAR(32) NOT NULL,
    "merchant_payment_no" VARCHAR(64) NOT NULL,
    "amount_fen" INTEGER NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'pending',
    "transaction_id" VARCHAR(64),
    "failure_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "self_order_payment_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "self_order_balance_transactions" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "type" VARCHAR(32) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "self_order_balance_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "self_orders_store_id_idx" ON "self_orders"("store_id");

-- CreateIndex
CREATE INDEX "self_orders_session_id_status_idx" ON "self_orders"("session_id", "status");

-- CreateIndex
CREATE INDEX "self_orders_space_id_status_idx" ON "self_orders"("space_id", "status");

-- CreateIndex
CREATE INDEX "self_orders_club_user_id_created_at_idx" ON "self_orders"("club_user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_self_orders_store_status_created" ON "self_orders"("store_id", "status", "created_at" DESC) WHERE (deleted_at IS NULL);

-- CreateIndex
CREATE UNIQUE INDEX "self_orders_store_id_order_no_key" ON "self_orders"("store_id", "order_no");

-- CreateIndex
CREATE UNIQUE INDEX "uq_self_orders_store_idempotency_key" ON "self_orders"("store_id", "idempotency_key") WHERE ((deleted_at IS NULL) AND (idempotency_key IS NOT NULL));

-- CreateIndex
CREATE INDEX "self_order_items_order_id_idx" ON "self_order_items"("order_id");

-- CreateIndex
CREATE INDEX "self_order_items_product_id_idx" ON "self_order_items"("product_id");

-- CreateIndex
CREATE INDEX "self_order_payment_attempts_order_id_status_idx" ON "self_order_payment_attempts"("order_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "self_order_payment_attempts_merchant_payment_no_key" ON "self_order_payment_attempts"("merchant_payment_no");

-- CreateIndex
CREATE INDEX "self_order_balance_transactions_customer_id_idx" ON "self_order_balance_transactions"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "self_order_balance_transactions_order_id_type_key" ON "self_order_balance_transactions"("order_id", "type");

-- CreateIndex
CREATE INDEX "space_session_items_session_id_source_order_no_idx" ON "space_session_items"("session_id", "source_order_no");

-- AddForeignKey
ALTER TABLE "self_order_items" ADD CONSTRAINT "self_order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "self_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "self_order_payment_attempts" ADD CONSTRAINT "self_order_payment_attempts_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "self_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "self_order_balance_transactions" ADD CONSTRAINT "self_order_balance_transactions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "self_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
