-- 群发短信：派发补偿 / 退费 / 通道对账所需字段
--
-- 背景：`dispatch()` 在扣费事务之外执行，进程崩溃或写库失败会让任务永久停留在
-- `sending`，既没有终态也没有补偿入口。补偿扫描依赖「status + updatedAt」定位
-- 卡死任务，并用 dispatch_attempts 限制重发次数（超过即转 failed，等人工退费）。

-- AlterTable
ALTER TABLE "sms_broadcast_tasks" ADD COLUMN     "refunded_amount_fen" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "dispatch_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "last_error" TEXT;

-- AlterTable
ALTER TABLE "sms_broadcast_recipients" ADD COLUMN     "provider_request_id" TEXT;

-- CreateIndex
CREATE INDEX "sms_broadcast_tasks_status_updated_at_idx" ON "sms_broadcast_tasks"("status", "updated_at");
