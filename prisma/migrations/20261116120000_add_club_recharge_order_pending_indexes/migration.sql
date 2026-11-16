-- purely-club 性能优化（索引批次）：补齐 ClubRechargeOrder 两个定时扫描的索引缺口
--
-- 背景：club_recharge_orders 是 20261027 新增的 C 端充值订单表（充值落账的幂等事实源），
--       晚于 docs/db-optimization 的 S3 索引审计，因此未被既有审计结论覆盖。
--       表上现有索引的前导列全是 store_id / user_id / sub_mch_id / promotion_id，
--       而下面两个周期任务都不带 store_id：
--
-- 1) idx_club_recharge_orders_pending_expiry
--    club-recharge-expiration.service.ts 扫描超时未支付订单，形状为
--      WHERE status = 'pending' AND expires_at <= now() AND deleted_at IS NULL
--      ORDER BY expires_at ASC LIMIT 100
--    无匹配索引时退化为全表扫描 + Sort，表随订单量线性增长后扫描成本同步上升。
--    谓词排除非 pending 与已软删行，索引只覆盖在途订单，体积与写放大都收敛。
--
-- 2) idx_club_recharge_orders_pending_created
--    club-recharge-reconciliation.service.ts 对账扫描陈旧 pending 订单，形状为
--      WHERE status = 'pending' AND created_at < 今日零点 AND deleted_at IS NULL
--      ORDER BY created_at ASC, id ASC LIMIT N
--    created_at + id 补齐键集推进所需的稳定次序，避免同刻订单在多轮扫描间抖动。
--
-- 时区假设：本迁移不涉及时间列类型变更，expires_at / created_at 仍为
--           TIMESTAMP(3) WITHOUT TIME ZONE，与应用会话时区 UTC 保持一致。
-- 上线提示：
--   * 本表当前为纯追加表，规模取决于在途与历史订单量；线上低峰执行更稳妥，
--     或手工改用 CREATE INDEX CONCURRENTLY 并跳过本迁移（两处索引均可独立创建）。
-- 回滚：
--   DROP INDEX IF EXISTS "idx_club_recharge_orders_pending_expiry";
--   DROP INDEX IF EXISTS "idx_club_recharge_orders_pending_created";

CREATE INDEX IF NOT EXISTS "idx_club_recharge_orders_pending_expiry"
  ON "club_recharge_orders" ("expires_at")
  WHERE status = 'pending' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS "idx_club_recharge_orders_pending_created"
  ON "club_recharge_orders" ("created_at", "id")
  WHERE status = 'pending' AND deleted_at IS NULL;
