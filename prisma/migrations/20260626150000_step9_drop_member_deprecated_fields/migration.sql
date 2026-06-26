-- Step 9: 删除 Member 表废弃的运行态字段
-- 这些字段已在 Step 2 改为 nullable，现在正式从 schema 删除
-- 
-- 数据迁移策略：
--   1. 先按 storeId + phone 回填 Member.customer_id / MarketingCustomer.member_id 双向外键
--   2. 再删除 Member 表中已废弃的运行态字段
--
-- 废弃字段清单（对应 spec 0.1 节）：
--   - level            → 改为从 MarketingCustomer.tier 读取
--   - points           → 改为从 MarketingCustomer.points 读取（仅营销积分语义）
--   - total_consume_amount → 改为从 MarketingCustomer.total_spent 读取
--   - total_consume_count  → 改为从 MarketingCustomer.visit_count 读取
--   - total_points_earned  → spec 说不再维护
--   - total_recharged      → spec 说不再维护
--   - recharge_count       → spec 说不再维护
--   - invited_count        → spec 说不再维护或迁移合伙人专属表
--   - last_consume_at      → 改为从 MarketingCustomer.last_visit_at 读取
--
-- 保留字段：
--   - bean_balance     → 会员纯利豆，独立于营销积分，保留在 Member

-- ============================================================
-- 阶段 1：回填 Member ↔ MarketingCustomer 双向外键
-- ============================================================

-- 1a. 回填 Member.customer_id（按 storeId + phone 匹配，仅处理尚未关联的记录）
UPDATE members m
SET customer_id = (
  SELECT mc.id
  FROM marketing_customers mc
  WHERE mc.store_id = m.store_id
    AND mc.phone = m.phone
    AND mc.deleted_at IS NULL
  LIMIT 1
)
WHERE m.customer_id IS NULL
  AND m.phone IS NOT NULL
  AND m.deleted_at IS NULL
  AND EXISTS (
    SELECT 1
    FROM marketing_customers mc
    WHERE mc.store_id = m.store_id
      AND mc.phone = m.phone
      AND mc.deleted_at IS NULL
  );

-- 1b. 回填 MarketingCustomer.member_id（反向，按 customer_id 已关联的 Member 来设置）
UPDATE marketing_customers mc
SET member_id = (
  SELECT m.id
  FROM members m
  WHERE m.customer_id = mc.id
    AND m.deleted_at IS NULL
  LIMIT 1
)
WHERE mc.member_id IS NULL
  AND mc.deleted_at IS NULL
  AND EXISTS (
    SELECT 1
    FROM members m
    WHERE m.customer_id = mc.id
      AND m.deleted_at IS NULL
  );

-- ============================================================
-- 阶段 2：删除 Member 表废弃字段
-- ============================================================

-- 删除等级字段（改为从 MarketingCustomer.tier 读取）
ALTER TABLE "members" DROP COLUMN IF EXISTS "level";

-- 删除积分字段（改为从 MarketingCustomer.points 读取）
ALTER TABLE "members" DROP COLUMN IF EXISTS "points";
ALTER TABLE "members" DROP COLUMN IF EXISTS "total_points_earned";

-- 删除消费统计字段（改为从 MarketingCustomer 读取）
ALTER TABLE "members" DROP COLUMN IF EXISTS "total_consume_amount";
ALTER TABLE "members" DROP COLUMN IF EXISTS "total_consume_count";
ALTER TABLE "members" DROP COLUMN IF EXISTS "last_consume_at";

-- 删除充值统计字段（spec 说不再维护）
ALTER TABLE "members" DROP COLUMN IF EXISTS "total_recharged";
ALTER TABLE "members" DROP COLUMN IF EXISTS "recharge_count";

-- 删除邀请数字段（spec 说不再维护）
ALTER TABLE "members" DROP COLUMN IF EXISTS "invited_count";

-- ============================================================
-- 阶段 3：删除 members 表上因废弃字段而存在的索引
-- ============================================================

-- 删除 level 字段索引（步骤 1 中创建的复合索引）
DROP INDEX IF EXISTS "members_store_id_level_updated_at_idx";

-- ============================================================
-- 阶段 4：清理 step6 创建但 schema 不声明的 (xxx_id, store_id) 复合索引
-- 这些索引在 apply_step8_step7_step9 中被 DROP，但 step6 时间戳更晚
-- 会重新创建它们。此处再次 DROP 以确保最终状态与 schema 一致。
-- ============================================================

DROP INDEX IF EXISTS "employee_leaves_employee_store_idx";
DROP INDEX IF EXISTS "employee_payrolls_employee_store_idx";
DROP INDEX IF EXISTS "employee_shifts_employee_store_idx";
DROP INDEX IF EXISTS "inventory_adjustment_logs_product_store_idx";
DROP INDEX IF EXISTS "marketing_consumptions_customer_store_idx";
DROP INDEX IF EXISTS "marketing_points_records_customer_store_idx";
DROP INDEX IF EXISTS "marketing_recharges_customer_store_idx";
DROP INDEX IF EXISTS "member_bean_logs_member_store_idx";
DROP INDEX IF EXISTS "member_points_logs_member_store_idx";
DROP INDEX IF EXISTS "member_recharge_logs_member_store_idx";
DROP INDEX IF EXISTS "partner_withdrawals_partner_store_idx";
DROP INDEX IF EXISTS "purchase_order_items_order_store_idx";
DROP INDEX IF EXISTS "sale_order_items_order_store_idx";
DROP INDEX IF EXISTS "space_sessions_space_store_idx";
DROP INDEX IF EXISTS "store_partner_bean_logs_partner_store_idx";
DROP INDEX IF EXISTS "cost_records_purchase_order_store_idx";
