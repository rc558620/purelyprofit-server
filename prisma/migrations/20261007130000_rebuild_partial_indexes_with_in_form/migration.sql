/* 将部分索引谓词从 = ANY (ARRAY[...]) 重建为语义等价的 IN (...) 形式。
 * prisma migrate diff 渲染 ANY 形式时吞掉 ARRAY 闭合括号（生成坏 SQL 且
 * diff 永远判定不一致），IN 形式无此问题。见 schema.prisma 内注释。 */

-- DropIndex
DROP INDEX "uq_scan_order_refund_task_active";

-- DropIndex
DROP INDEX "idx_service_calls_store_open";

-- DropIndex
DROP INDEX "uq_service_calls_club_user_store_type_open";

-- CreateIndex
CREATE UNIQUE INDEX "uq_scan_order_refund_task_active" ON "scan_order_refund_tasks"("order_id") WHERE ("status" IN ('pending', 'refunding', 'manual_pending'));

-- CreateIndex
CREATE INDEX "idx_service_calls_store_open" ON "service_calls"("store_id", "status", "requested_at") WHERE ("status" IN ('pending', 'processing'));

-- CreateIndex
CREATE UNIQUE INDEX "uq_service_calls_club_user_store_type_open" ON "service_calls"("club_user_id", "store_id", "type") WHERE ("status" IN ('pending', 'processing'));

