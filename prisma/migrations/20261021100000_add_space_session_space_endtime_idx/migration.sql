/* ── space_sessions 空间维度「最近一条已结账会话」缺索引 ────────
 *
 * 以下四处查询形态一致：按 spaceId 过滤 settled 会话，再按 endTime 降序取一条：
 *   - spaces-read.service.ts（listSpaces 的脏房 cleaning 状态推导）
 *   - spaces-status.service.ts（deriveSpaceStatus / markSpaceReady 的状态推导）
 *   - space-reservations-state.service.ts（resolveReservationBackStatus）
 *
 * 现有索引均无法覆盖：
 *   - space_sessions_space_id_status_start_time_idx：以 startTime 收尾，
 *     endTime 排序只能在过滤结果上做 Sort；单空间历史会话累积后退化为
 *     「索引扫描 + 排序」。
 *   - space_sessions_store_id_status_end_time_id_idx：前导列是 store_id，
 *     只知道 space_id 时无法用于索引定位。
 *
 * 新索引 (space_id, status, end_time DESC) 让四处的 ORDER BY end_time DESC
 * LIMIT 1 直接走索引前向扫描，无需排序。
 *
 * 之所以不放 storeId 前导：调用方持有的是 spaceId（单空间维度），
 * storeId 前导的现有索引在该场景下不可用。
 *
 * 生产环境说明：存量表建议改为
 *   CREATE INDEX CONCURRENTLY "space_sessions_space_id_status_end_time_idx"
 *     ON "space_sessions" ("space_id", "status", "end_time" DESC);
 * 在事务外单独执行（Prisma migrate 会把迁移包在事务里，CONCURRENTLY 无法在内部运行）。
 *
 * 回滚：
 *   DROP INDEX IF EXISTS "space_sessions_space_id_status_end_time_idx";
 */

CREATE INDEX IF NOT EXISTS "space_sessions_space_id_status_end_time_idx"
  ON "space_sessions"("space_id", "status", "end_time" DESC);
