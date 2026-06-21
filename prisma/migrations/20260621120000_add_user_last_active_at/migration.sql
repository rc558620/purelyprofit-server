-- AlterTable: 给用户表添加最近活跃时间字段
-- JWT 鉴权成功时异步更新此字段，用于 Pulse 会员管理列表/详情的 lastActiveAt 展示
ALTER TABLE "users" ADD COLUMN "last_active_at" TIMESTAMP(3);

-- Backfill: 用 updatedAt 作为初始活跃时间的近似值
-- 避免所有历史用户的 lastActiveAt 为 NULL 导致 fallback 到充值时间/过期时间
-- 用户下次登录时 JWT 鉴权会自动更新为真实活跃时间
UPDATE "users" SET "last_active_at" = "updated_at" WHERE "last_active_at" IS NULL;
