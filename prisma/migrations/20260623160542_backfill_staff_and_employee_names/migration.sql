-- 数据迁移: 同步 users.name 到 staffs.name 和 employees.name
-- 背景: 之前修改昵称时只更新了 users.name，导致 staffs.name 和 employees.name 存储旧值

-- Step 1: 回填 staffs.name（从关联的 users.name 同步）
UPDATE "staffs" s
SET name = u.name
FROM "users" u
WHERE s.user_id = u.id
  AND u.name IS NOT NULL
  AND u.name != '';

-- Step 2: 回填 employees.name（从关联的 staffs.name 同步）
UPDATE "employees" e
SET name = s.name
FROM "staffs" s
WHERE e.linked_staff_id = s.id;
