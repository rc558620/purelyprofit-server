-- ═══════════════════════════════════════════════════════════════════════
-- Add change_type column to store_membership_points_logs
--
-- 修复 check constraint 冲突：代码中长期用负数 change_amount 表示扣减，
-- 但 safety 迁移 (20260627000000) 添加了 CHECK (change_amount >= 0)。
--
-- 对齐 member_points_logs 表的设计：增加 change_type 字段区分增减，
-- change_amount 一律存储正数，由 change_type 标记方向。
-- ═══════════════════════════════════════════════════════════════════════

-- Step 1: 添加 change_type 列，默认 increase（占位，Step 2 会回填）
ALTER TABLE store_membership_points_logs
  ADD COLUMN change_type "MemberPointsChangeType" NOT NULL DEFAULT 'increase';

-- Step 2: 回填历史数据
--   change_amount >= 0 的行 → increase
--   change_amount <  0 的行 → decrease, 并取绝对值
UPDATE store_membership_points_logs
SET change_type = 'decrease',
    change_amount = ABS(change_amount)
WHERE change_amount < 0;

-- Step 3: 确认约束 chk_store_membership_points_logs_change_amount (change_amount >= 0) 已存在，
-- 无需重建，回填后所有行均满足该约束。
