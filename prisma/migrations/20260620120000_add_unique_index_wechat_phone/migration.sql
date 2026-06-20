-- AddUniqueIndex: wechatPhone 字段增加唯一索引，防止多个用户绑定同一手机号导致查找歧义
-- 先清理可能的重复数据（保留最早创建的记录，将后续重复记录的 wechat_phone 置 NULL）
UPDATE users
SET wechat_phone = NULL
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY wechat_phone ORDER BY created_at ASC, id ASC) AS rn
    FROM users
    WHERE wechat_phone IS NOT NULL
  ) sub
  WHERE rn > 1
);

-- 创建唯一索引
CREATE UNIQUE INDEX IF NOT EXISTS "users_wechat_phone_key" ON "users"("wechat_phone");
