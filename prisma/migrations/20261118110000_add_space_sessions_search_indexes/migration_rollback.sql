/* 回滚：移除空间会话搜索/空间维度索引。
 *
 * 不 DROP EXTENSION pg_trgm —— 该扩展由 20260610120000_add_search_trgm_indexes
 * 引入，其它表（products / inventory_adjustment_logs）的 trgm 索引仍在依赖它。
 */
DROP INDEX IF EXISTS "idx_space_sessions_space_phone";
DROP INDEX IF EXISTS "idx_space_sessions_guest_name_trgm";
