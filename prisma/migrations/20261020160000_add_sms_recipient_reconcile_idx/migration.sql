/* ── sms_broadcast_recipients 缺后台扫描索引 ──────────────────
 * 该表随群发量线性增长（一次群发 = 一条明细），是短信域唯一的大表。
 * 两个定时任务都会**不带 taskId** 全库扫描，现有索引全部以 task_id 为前导列，
 * 一个都用不上，表越大每轮扫描越慢（每轮都要 BEGIN/COMMIT + 全表扫）。
 *
 * 1) 回执核销（sms-delivery-reconcile.service.ts reconcileMissingDelivery）：
 *      delivery_status IS NULL AND serial_no IS NOT NULL
 *      AND created_at BETWEEN [max_age天前, wait小时前]
 *      ORDER BY created_at ASC LIMIT n
 *    → 部分索引把扫描集收敛到「已提交但还没回执」这个小集合，
 *      且 created_at 有序，ORDER BY + LIMIT 可直接走索引顺序扫描。
 *
 * 2) 退费兜底（sms-refund.service.ts refundUndeliveredFailures，taskId 缺省时扫全库）：
 *      refunded_at IS NULL AND status = 'failed'
 *      ORDER BY id ASC LIMIT n
 *    → 退费是幂等的（refunded_at 闸门），扫描集只有「未退的失败明细」，
 *      任务跑几轮后这个集合会收敛到很小；部分索引让它不必每轮全表扫。
 *
 * 生产环境说明：存量表上加索引建议改为
 *   CREATE INDEX CONCURRENTLY ...
 * 单独在事务外执行（Prisma migrate 会把迁移包在事务里，CONCURRENTLY 无法在内运行）。
 *
 * 回滚：
 *   DROP INDEX IF EXISTS "idx_sms_recipients_pending_delivery";
 *   DROP INDEX IF EXISTS "idx_sms_recipients_unrefunded_failed";
 */

-- 1. 回执核销扫描
CREATE INDEX IF NOT EXISTS "idx_sms_recipients_pending_delivery"
  ON "sms_broadcast_recipients" ("created_at")
  WHERE "delivery_status" IS NULL AND "serial_no" IS NOT NULL;

-- 2. 退费兜底扫描
CREATE INDEX IF NOT EXISTS "idx_sms_recipients_unrefunded_failed"
  ON "sms_broadcast_recipients" ("id")
  WHERE "status" = 'failed' AND "refunded_at" IS NULL;
