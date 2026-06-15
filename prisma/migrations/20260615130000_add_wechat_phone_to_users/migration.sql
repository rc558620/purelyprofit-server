-- 为微信登录用户绑定真实手机号
-- 当前微信用户无手机号，通过 open-type=getPhoneNumber 授权后可拿到
-- wechat_phone：微信授权的真实手机号（E.164 格式，如 +8613800138000）
-- 作用：
--   1. 与手机号登录账号合并（wechat_phone = 手机号账号邮箱中编码的手机号时直接关联）
--   2. 作为 JWT phone 字段，替代 club_wechat:{openid} 占位符
--   3. 让微信用户与手机号用户在同一账号体系内互通

-- AlterTable
ALTER TABLE "users" ADD COLUMN "wechat_phone" TEXT;

-- CreateIndex（可选：手机号唯一约束）
-- 目前不加唯一索引，允许同一手机号同时绑定一个微信账号和一个手机号账号，
-- 合并逻辑在应用层做，DB 层保持宽松。
