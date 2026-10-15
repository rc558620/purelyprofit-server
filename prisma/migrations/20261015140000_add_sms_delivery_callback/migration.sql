-- 群发短信：接入腾讯云**送达状态回执**
--
-- 背景：腾讯云按「送达成功」计费，而我们在 SendSms 同步返回时就按「受理成功」
-- 全额扣了商户的钱。空号 / 停机 / 黑名单这类号码受理是成功的、运营商回执是失败的，
-- 于是出现了「腾讯云不收我们的钱，我们却扣了商户的钱」的口径偏差。
--
-- 这套字段用于：发送时留存 serialNo → 运营商回执回来时对回明细 →
-- 送达失败的按条数把差额自动退回商户，让系统扣费口径与腾讯云计费口径对齐。

CREATE TYPE "SmsDeliveryStatus" AS ENUM ('delivered', 'failed');

-- ─── 收件人明细：留存流水号 + 送达结果 + 自动退费闸门 ───
ALTER TABLE "sms_broadcast_recipients"
  ADD COLUMN "serial_no" TEXT,
  ADD COLUMN "delivery_status" "SmsDeliveryStatus",
  ADD COLUMN "delivery_code" TEXT,
  ADD COLUMN "delivery_message" TEXT,
  ADD COLUMN "delivered_at" TIMESTAMP(3),
  ADD COLUMN "refunded_at" TIMESTAMP(3);

-- 回执只带流水号，必须能靠它直接定位到明细
CREATE INDEX "sms_broadcast_recipients_serial_no_idx" ON "sms_broadcast_recipients"("serial_no");
CREATE INDEX "sms_broadcast_recipients_task_id_delivery_status_idx" ON "sms_broadcast_recipients"("task_id", "delivery_status");

-- ─── 群发任务：回执口径计数 + 自动退费累计 ───
ALTER TABLE "sms_broadcast_tasks"
  ADD COLUMN "delivery_success_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "delivery_failed_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "auto_refunded_fen" INTEGER NOT NULL DEFAULT 0;
