-- 创建扫码点餐退款任务表
-- 用于跟踪异常支付退款（已关闭订单收到支付成功回调）和商家拒单退款

CREATE TYPE "ScanOrderRefundTaskStatus" AS ENUM (
    'pending',
    'refunding',
    'succeeded',
    'failed',
    'manual_pending'
);

CREATE TYPE "ScanOrderRefundTrigger" AS ENUM (
    'anomalous_payment',
    'merchant_reject'
);

CREATE TABLE "scan_order_refund_tasks" (
    "id" SERIAL PRIMARY KEY,
    "order_id" INTEGER NOT NULL,
    "store_id" INTEGER NOT NULL,
    "payment_attempt_id" INTEGER,
    "trigger_type" "ScanOrderRefundTrigger" NOT NULL,
    "status" "ScanOrderRefundTaskStatus" NOT NULL DEFAULT 'pending',
    "refund_amount" INTEGER NOT NULL,
    "merchant_payment_no" VARCHAR(64),
    "provider_transaction_id" VARCHAR(128),
    "provider_refund_no" VARCHAR(64),
    "provider_refund_id" VARCHAR(128),
    "failure_reason" VARCHAR(500),
    "operator_type" VARCHAR NOT NULL DEFAULT 'system',
    "operator_id" INTEGER,
    "triggered_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "refund_succeeded_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "scan_order_refund_tasks_order_id_fkey"
        FOREIGN KEY ("order_id") REFERENCES "scan_orders"("id") ON DELETE CASCADE
);

CREATE INDEX "scan_order_refund_tasks_order_id_idx" ON "scan_order_refund_tasks"("order_id");
CREATE INDEX "scan_order_refund_tasks_store_id_status_idx" ON "scan_order_refund_tasks"("store_id", "status");
CREATE INDEX "scan_order_refund_tasks_trigger_type_status_idx" ON "scan_order_refund_tasks"("trigger_type", "status");
