/* ── space_sessions 搜索/空间维度索引（批次 D）────────────────────────────────
 * ⚠️ 本迁移依赖批次 C2 的结论：`ILIKE '%x%'` 是否值得用 pg_trgm 索引承载。
 *    若最终选择「改成前缀匹配」或「加 spaceId 收敛」，第 1、2 段需要重写。
 *
 * 现状（动手前已核对 schema）：
 *   - space_sessions 已有 (store_id, guest_phone)、(space_id, status, start_time)
 *   - 门店维度搜索 `WHERE store_id = ? AND guest_name ILIKE '%kw%'`：
 *     无 trgm GIN，btree 对前后通配符无效 → 只能按 (store_id, ...) 取该店全部会话再过滤
 *   - 空间维度 `WHERE space_id = ? AND guest_phone LIKE 'kw%'`：
 *     唯一可用索引是 (space_id, status, start_time)，phone 的前缀条件无法下推
 *     （现有 (store_id, guest_phone) 前导列不是 space_id，用不上）
 *
 * 锁与执行说明（生产必读）：
 *   - `CREATE EXTENSION` 需要 `CREATE` 权限；托管 PG（RDS / 部分云厂商）要求
 *     `rds_superuser` 或控制台开启，**上线前必须确认扩展已存在**：
 *       SELECT extname FROM pg_extension WHERE extname = 'pg_trgm';
 *     项目已在 20260610120000_add_search_trgm_indexes 中启用过一次，若该迁移
 *     已在生产执行，则本条是幂等 no-op。
 *   - `CREATE INDEX CONCURRENTLY` **不能**出现在 Prisma migration 里：Prisma 默认
 *     把整个迁移包在事务中执行，而 CONCURRENTLY 禁止在事务块内运行（会报
 *     25001 CREATE INDEX CONCURRENTLY cannot run inside a transaction block）。
 *     因此下面写的是普通 CREATE INDEX（会持有 SHARE 锁阻塞写入）。
 *     生产执行方式二选一：
 *       (a) 低峰期直接跑本迁移（space_sessions 行数通常在十万级，建索引秒级~十几秒）；
 *       (b) 从本文件复制第 2、3 段，在事务外手工改写成 CONCURRENTLY 执行，
 *           然后把本迁移标记为已应用。
 *
 * 回滚：见同目录 migration_rollback.sql
 */

-- 1. 模糊搜索前置：guest_name ILIKE '%kw%' 走 GIN 位图索引扫描
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "idx_space_sessions_guest_name_trgm"
  ON "space_sessions" USING GIN ("guest_name" gin_trgm_ops);

-- 2. 空间维度手机号前缀匹配：(space_id, guest_phone)
--    生产等价写法（事务外单独执行）：
--      CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_space_sessions_space_phone"
--        ON "space_sessions" ("space_id", "guest_phone");
CREATE INDEX IF NOT EXISTS "idx_space_sessions_space_phone"
  ON "space_sessions" ("space_id", "guest_phone");

/* 说明：space.name 的搜索走的是 space_sessions JOIN spaces，
 * 若要一并优化需要给 spaces.name 建 trgm 索引（表更小、行数少一个量级），
 * 本条迁移暂不包含 —— 等 C2 结论确认搜索路径后再定，避免建了用不上的索引。
 */
