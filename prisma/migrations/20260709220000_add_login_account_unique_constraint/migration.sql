-- 清理可能存在的的 loginAccount 重复数据：保留 id 最大的记录，其余置 NULL
UPDATE staffs
SET login_account = NULL
WHERE id NOT IN (
    SELECT MAX(id)
    FROM staffs
    WHERE login_account IS NOT NULL
    GROUP BY login_account
)
AND login_account IS NOT NULL;

-- 添加 loginAccount 全局唯一约束（PostgreSQL 允许 NULL 值重复，仅约束非 NULL 值）
CREATE UNIQUE INDEX "staffs_login_account_key" ON "staffs"("login_account");
