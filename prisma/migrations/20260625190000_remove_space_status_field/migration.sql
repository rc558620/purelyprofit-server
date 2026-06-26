-- Step 3: 移除 Space.status 字段（0.7 方案 A）
-- 改为通过 SpaceSession/SpaceReservation 推导运行态状态

-- 删除依赖 status 的复合索引
DROP INDEX IF EXISTS "spaces_store_id_status_sort_order_idx";

-- 删除 status 列
ALTER TABLE "spaces" DROP COLUMN IF EXISTS "status";

-- 删除 SpaceStatus 枚举（如果数据库中存在）
DROP TYPE IF EXISTS "SpaceStatus";
