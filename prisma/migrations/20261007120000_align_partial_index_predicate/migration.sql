/*
 * 对齐 uq_scan_order_refund_task_active 部分索引的谓词表达。
 *
 * 上一条迁移（20261007110000）曾把该索引用 `IN (...)` 形式重建（因 prisma
 * migrate diff 对 schema 里 raw("status = ANY (ARRAY[...])") 渲染时吞掉了
 * ARRAY 的闭合 `]`，原样执行会语法错误）。`IN` 与 `= ANY (ARRAY[...])` 在
 * Postgres 中语义等价，但 prisma 的 diff 按 predicate 文本比对，视两者为
 * 不同索引，导致每次 diff 都会再生一条 DROP/CREATE 噪音。
 *
 * 本迁移按 schema.prisma 的 raw 原文重建谓词（手工补回被渲染吞掉的 `]`），
 * 使库内定义与 schema 文本一致，diff 归零。
 */
DROP INDEX IF EXISTS "uq_scan_order_refund_task_active";

-- CreateIndex
CREATE UNIQUE INDEX "uq_scan_order_refund_task_active" ON "scan_order_refund_tasks"("order_id") WHERE (status = ANY (ARRAY['pending'::"ScanOrderRefundTaskStatus", 'refunding'::"ScanOrderRefundTaskStatus", 'manual_pending'::"ScanOrderRefundTaskStatus"]));
