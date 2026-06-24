-- AlterTable: 在 sale_orders 表新增操作员名称快照字段
-- 目的: 记录订单创建时的操作员昵称，避免后续修改昵称导致历史记录显示新名称
ALTER TABLE "sale_orders" ADD COLUMN "operator_name_snapshot" VARCHAR(100);

-- 数据回填: 从当前关联的 staffs.name 回填历史订单的操作员名称快照
UPDATE "sale_orders" so
SET operator_name_snapshot = s.name
FROM "staffs" s
WHERE so.operator_staff_id = s.id
  AND s.name IS NOT NULL
  AND s.name != '';
