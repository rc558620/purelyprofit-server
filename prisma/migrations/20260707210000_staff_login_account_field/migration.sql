-- 为 Staff 表新增独立的 loginAccount 字段
-- 消除 email 字段多语义编码问题，loginAccount 直接存储自定义登录账号

-- 1. 添加列
ALTER TABLE "staffs" ADD COLUMN "login_account" TEXT;

-- 2. 从 email 反填 loginAccount（仅自定义账号格式，手机号格式保持 NULL）
-- 当前格式：profit_account_{account}@purelyprofit.local
UPDATE "staffs"
SET "login_account" = substring("email" from '^profit_account_(.+)@purelyprofit\.local$')
WHERE "email" ~ '^profit_account_.+@purelyprofit\.local$';

-- 旧格式：account_{account}@purelyprofit.local
UPDATE "staffs"
SET "login_account" = substring("email" from '^account_(.+)@purelyprofit\.local$')
WHERE "login_account" IS NULL
  AND "email" ~ '^account_.+@purelyprofit\.local$';

-- 3. 添加索引
CREATE INDEX "staffs_login_account_idx" ON "staffs" ("login_account");
