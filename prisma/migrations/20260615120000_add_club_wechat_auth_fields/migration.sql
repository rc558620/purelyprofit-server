-- 为 purely-club 微信登录新增用户微信身份字段
-- wechat_openid：每个小程序 appid 下唯一，用于查找/绑定账号
-- wechat_unionid：同一微信开放平台主体下跨应用唯一（微信会在满足条件时返回）
-- wechat_avatar：微信头像 URL（小程序 getUserProfile 或 getUserInfo 返回）
-- wechat_nickname：微信昵称

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "wechat_avatar" TEXT,
ADD COLUMN     "wechat_nickname" TEXT,
ADD COLUMN     "wechat_openid" TEXT,
ADD COLUMN     "wechat_unionid" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_wechat_openid_key" ON "users"("wechat_openid");
