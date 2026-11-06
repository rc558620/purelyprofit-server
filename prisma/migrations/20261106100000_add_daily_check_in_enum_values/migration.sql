-- 每日签到（一）：仅做枚举加值，不创建任何表 / 索引。
--
-- 回滚成本与兼容期：
-- - PostgreSQL 不支持 DROP VALUE；如需回滚必须重建枚举类型（改列类型 → DROP TYPE →
--   CREATE TYPE → 改回），且必须先清理所有引用该值的行，属于高成本不可逆操作。
-- - 因此本迁移可独立先上线：旧版本服务不认识新枚举值时不会写入、不会读取，
--   是安全的兼容期；新版本服务回退到旧版本时，只要不使用签到活动即可共存。
-- - 新枚举值在同一事务内不可被立即使用（PG 限制），所以「引用 daily_check_in
--   的部分唯一索引」放在下一个独立迁移 20261106101000 中执行。

-- AlterEnum
ALTER TYPE "MarketingPromotionType" ADD VALUE 'daily_check_in';

-- AlterEnum：签到积分的会员审计流水来源。
-- 注意：MemberPointsSource 是被 member_points_logs 与 store_membership_points_logs
-- 共用的枚举，purelyPulse 管理端积分流水响应也会透传该值；前端需同步来源映射，
-- 因此这不是「纯后端、无前端影响」的变更，灰度期需与前端一起上线。
ALTER TYPE "MemberPointsSource" ADD VALUE 'check_in';
