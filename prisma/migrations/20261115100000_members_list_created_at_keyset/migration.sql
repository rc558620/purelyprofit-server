-- 会员列表 keyset 分页：排序键由可变的 updated_at 换成不可变的 created_at
--
-- 场景：GET /members 原排序链为 `updated_at DESC, id DESC`。updated_at 是 Prisma
-- `@updatedAt` 自动刷新列，任何会员编辑（改备注、改手机号、调纯利豆、C 端绑号）
-- 都会把该行顶到列表首页，游标分页的「不漏不重」在并发写下失效：
--   * 未读行被顶上首页 → 落在游标之前 → 本次会话再也取不到（漏读）；
--   * 已读行被顶上首页 → 与客户端已加载页重复。
-- created_at 不随写入变化，排序位置恒定，才能兑现游标承诺。
--
-- 索引依据（诊断库 20 万行会员 / 单店 2000 行，EXPLAIN (ANALYZE, BUFFERS) 实测）：
--   无本索引：Bitmap Heap Scan on members_store_id_phone_idx + top-N heapsort
--             3555 buffers / 6.035 ms；深页 3216 buffers / 2.502 ms
--   有本索引：Index Scan using members_store_id_created_at_id_idx
--             19 buffers / 0.061 ms；深页 18 buffers / 0.054 ms
--   既有 (store_id, updated_at) 部分索引无法服务 created_at 排序。
--
-- 时区假设：不涉及时间列类型变更，created_at 仍为 TIMESTAMP(3) WITHOUT TIME ZONE。
-- 上线提示：members 表规模有限，直接建索引可接受；若线上单店会员量增长明显，
--           可手工改用 CREATE INDEX CONCURRENTLY 并跳过本迁移。
-- 回滚：DROP INDEX IF EXISTS "members_store_id_created_at_id_idx";

CREATE INDEX IF NOT EXISTS "members_store_id_created_at_id_idx"
  ON "members" ("store_id", "created_at" DESC, "id" DESC)
  WHERE "deleted_at" IS NULL;
