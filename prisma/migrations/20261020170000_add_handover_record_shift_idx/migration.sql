/* ── store_handover_records 缺「班次交班判定」索引 ──────────────
 * 交班页每次加载都要判定班次是否已交班，这些查询全部按
 * employee_shift_id_snapshot / handover_at 过滤，而现有索引以 created_at 结尾
 * （[store_id,status,created_at] / [from_employee_id,created_at] / [to_employee_id,created_at]），
 * 一个都用不上，只能 Seq Scan，随门店交班历史累积越来越慢：
 *
 * 1) isShiftHandedOver（handover-shift-handover-status.service.ts）
 *      store_id + from_employee_id + status
 *      AND (employee_shift_id_snapshot = :id OR (IS NULL AND handover_at BETWEEN …))
 * 2) loadHandedOverShiftIds（同上，批量版）
 *      store_id + status AND (snapshot IN (…) OR (IS NULL AND handover_at BETWEEN …))
 * 3) findShiftInitializedStartAt（handover-page-metrics.ts resolvePageShiftRange）
 *      store_id + status = 'completed' + handover_at BETWEEN …
 *      ORDER BY handover_at DESC LIMIT 1
 * 4) ensureShiftNotHandedOver（handover-confirm-shift.service.ts）
 *      交班确认事务内的重复交班校验，过滤条件同 1)/3)
 *
 * 两个索引分别覆盖「有 snapshot 的精确匹配」与「无 snapshot 的时间窗口兜底」。
 *
 * 生产环境说明：存量表上加索引建议改为
 *   CREATE INDEX CONCURRENTLY ...
 * 单独在事务外执行（Prisma migrate 会把迁移包在事务里，CONCURRENTLY 无法在内运行）。
 *
 * 回滚：
 *   DROP INDEX IF EXISTS "idx_store_handover_records_shift_snapshot";
 *   DROP INDEX IF EXISTS "idx_store_handover_records_handover_at";
 */

-- 1. 班次快照精确匹配
CREATE INDEX IF NOT EXISTS "idx_store_handover_records_shift_snapshot"
  ON "store_handover_records" ("store_id", "employee_shift_id_snapshot");

-- 2. 交班时间窗口兜底匹配 + 取本班次最近一次交班
CREATE INDEX IF NOT EXISTS "idx_store_handover_records_handover_at"
  ON "store_handover_records" ("store_id", "status", "handover_at" DESC);
