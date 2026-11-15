-- purely-club 性能优化（索引批次）：补齐 C 端三类高频查询的索引缺口
--
-- 场景与依据：
--
-- 1) idx_points_records_store_customer_created
--    GET /club/points/records 与积分余额快照反推查询形状为
--      WHERE store_id = ? AND customer_id = ?
--        AND created_at >= ?/created_at < ?
--      ORDER BY created_at DESC, id DESC
--    现有索引只有 (store_id, created_at)、(customer_id, created_at) 两列，
--    store_id 与 customer_id 同时等值时另一列只能回表过滤；余额快照
--    listBalanceRecordsSince 还是无上限的全量扫描，单顾客流水越长越慢。
--    对比 marketing_consumptions 已有 (store_id, customer_id, created_at)，
--    本表口径与之对齐并补上排序键 id 以支持键集分页。
--
-- 2) idx_promotions_store_enabled_type_end
--    C 端活动查询（活动列表 / 充值套餐 / 签到活动 / 积分翻倍）形状统一为
--      WHERE store_id = ? AND enabled = true AND type IN (...) AND end_at >= now()
--    现有 (store_id, enabled, start_at) 第三列是 start_at，无法定位 type；
--    `type='daily_check_in'` 的 findFirst 只能扫该门店全部上架活动。
--
-- 3) idx_member_cards_customer_created
--    GET /club/cards 形状为
--      WHERE customer_id IN (...) AND status <> 'refunded'
--      ORDER BY created_at DESC, id DESC
--    status 是不等值条件，既有 (customer_id, status, created_at DESC) 无法
--    提供有序输出，优化器需额外 Sort；补齐纯排序键路径。
--
-- 时区假设：本迁移不涉及时间列类型变更，created_at / end_at 仍为
--           TIMESTAMP(3) WITHOUT TIME ZONE。
-- 上线提示：
--   * marketing_points_records 为增长最快的流水表，线上直接建索引会阻塞写入，
--     建议低峰执行，或手工改用 CREATE INDEX CONCURRENTLY 并跳过本迁移；
--   * marketing_promotions / member_cards 规模有限，直接建索引可接受。
-- 回滚：
--   DROP INDEX IF EXISTS "idx_points_records_store_customer_created";
--   DROP INDEX IF EXISTS "idx_promotions_store_enabled_type_end";
--   DROP INDEX IF EXISTS "idx_member_cards_customer_created";

CREATE INDEX IF NOT EXISTS "idx_points_records_store_customer_created"
  ON "marketing_points_records" ("store_id", "customer_id", "created_at" DESC, "id" DESC);

CREATE INDEX IF NOT EXISTS "idx_promotions_store_enabled_type_end"
  ON "marketing_promotions" ("store_id", "enabled", "type", "end_at");

CREATE INDEX IF NOT EXISTS "idx_member_cards_customer_created"
  ON "member_cards" ("customer_id", "created_at" DESC, "id" DESC);
