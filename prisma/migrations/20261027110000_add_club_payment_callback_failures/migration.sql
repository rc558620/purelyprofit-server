-- purelyClub 支付回调落账死信表。
-- 背景：回调队列重试耗尽后此前只留一行日志，没有人会被通知到，
-- 结果往往等到用户投诉「钱扣了、余额没到账」才被发现。
-- 本表把这类订单固化成可查询、可认领、可闭环的记录，并作为管理端补单入口的事实源。

-- CreateTable
CREATE TABLE "club_payment_callback_failures" (
    "id" SERIAL NOT NULL,
    "order_no" TEXT NOT NULL,
    "order_type" TEXT NOT NULL,
    "store_id" INTEGER,
    "transaction_id" TEXT,
    "amount_fen" INTEGER,
    "stage" TEXT NOT NULL DEFAULT 'queue_retry_exhausted',
    "reason" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "payload_snapshot" JSONB,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "resolution_note" TEXT,
    "resolved_at" TIMESTAMP(3),
    "resolved_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "club_payment_callback_failures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: 业务订单号唯一，同一订单反复失败只更新同一条待办
CREATE UNIQUE INDEX "club_payment_callback_failures_order_no_key" ON "club_payment_callback_failures"("order_no");

-- CreateIndex: 管理端「待处理」列表按时间倒序取
CREATE INDEX "club_payment_callback_failures_status_created_at_idx" ON "club_payment_callback_failures"("status", "created_at" DESC);

-- CreateIndex: 门店维度排查（某门店集中失败通常是收款配置问题）
CREATE INDEX "club_payment_callback_failures_store_id_created_at_idx" ON "club_payment_callback_failures"("store_id", "created_at" DESC);
