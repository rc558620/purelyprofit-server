/* 回滚：移除空间会话等值定位键与结账回填专用索引。
 *
 * 注意顺序：先删索引再删列（列被索引引用时无法直接 DROP）。
 * 回滚后结账回填必须同步改回「note 字符串匹配」的实现，
 * 否则 updateMany 的 where 会引用不存在的列而报错。
 */
DROP INDEX IF EXISTS "idx_inventory_adjustment_logs_pending_space_session";

ALTER TABLE "inventory_adjustment_logs"
  DROP COLUMN IF EXISTS "related_space_session_id";
