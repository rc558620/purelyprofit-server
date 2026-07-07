-- 为 active Staff 的 email 添加全局唯一约束（partial index）
-- 确保 loginAccount 在数据库层面全局唯一，杜绝并发竞态导致的串号问题
-- 仅对 is_active = true 的记录生效，已禁用的 Staff（离职/删除）不参与约束

CREATE UNIQUE INDEX "staffs_active_email_unique" ON "staffs" ("email") WHERE "is_active" = true;
