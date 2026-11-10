-- marketing 模块性能优化（第一批）：补齐群发收件人写回索引
--
-- 场景：SmsBroadcastService.persistResults 对每个收件人执行
--   UPDATE sms_broadcast_recipients SET ... WHERE task_id = ? AND phone = ?
-- 原索引 (task_id, status) 无法定位 phone，万人群发会逐条扫描同一 task 下
-- 的全部收件人，整体退化为 O(N²)。
--
-- 时区假设：本迁移不涉及时间列。
-- 上线提示：大表建索引会短暂阻塞写入，建议在低峰执行；如需在线建索引，
--           可手工改用 CREATE INDEX CONCURRENTLY 并跳过本迁移。
-- 回滚：DROP INDEX IF EXISTS "sms_broadcast_recipients_task_id_phone_idx";

CREATE INDEX IF NOT EXISTS "sms_broadcast_recipients_task_id_phone_idx"
  ON "sms_broadcast_recipients" ("task_id", "phone");
