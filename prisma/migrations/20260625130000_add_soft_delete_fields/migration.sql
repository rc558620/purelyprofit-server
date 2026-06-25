-- 为 Store 和 Member 添加软删除字段
-- deletedAt 非 null 表示已删除，值为删除时间
-- 默认 null 表示未删除

ALTER TABLE "stores" ADD COLUMN "deleted_at" TIMESTAMP;

ALTER TABLE "members" ADD COLUMN "deleted_at" TIMESTAMP;

-- 为软删除字段添加索引，加速"未删除记录"过滤查询
CREATE INDEX "stores_deleted_at_idx" ON "stores"("deleted_at") WHERE "deleted_at" IS NULL;
CREATE INDEX "members_store_id_deleted_at_idx" ON "members"("store_id", "deleted_at") WHERE "deleted_at" IS NULL;
