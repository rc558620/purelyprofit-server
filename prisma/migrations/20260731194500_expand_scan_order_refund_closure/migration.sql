-- 扩展扫码点餐退款任务，支持用户申请、失败重试与可审计的渠道退款。
ALTER TYPE "ScanOrderRefundTrigger" ADD VALUE IF NOT EXISTS 'club_user';

ALTER TABLE "scan_order_refund_tasks"
  ADD COLUMN "customer_id" INTEGER,
  ADD COLUMN "refund_no" VARCHAR(64),
  ADD COLUMN "payment_channel" VARCHAR(32),
  ADD COLUMN "reason" VARCHAR(200),
  ADD COLUMN "points_refund_status" VARCHAR(32) NOT NULL DEFAULT 'not_supported',
  ADD COLUMN "retry_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "provider_response" JSONB,
  ADD COLUMN "processed_at" TIMESTAMPTZ;

UPDATE "scan_order_refund_tasks"
SET "refund_no" = CONCAT('SOR', "id", TO_CHAR("created_at", 'YYYYMMDDHH24MISS'))
WHERE "refund_no" IS NULL;

ALTER TABLE "scan_order_refund_tasks"
  ALTER COLUMN "refund_no" SET NOT NULL;

CREATE UNIQUE INDEX "scan_order_refund_tasks_refund_no_key"
  ON "scan_order_refund_tasks"("refund_no");

CREATE INDEX "scan_order_refund_tasks_customer_id_created_at_idx"
  ON "scan_order_refund_tasks"("customer_id", "created_at" DESC);

CREATE UNIQUE INDEX "uq_scan_order_refund_task_active"
  ON "scan_order_refund_tasks"("order_id")
  WHERE "status" IN ('pending', 'refunding', 'manual_pending');
