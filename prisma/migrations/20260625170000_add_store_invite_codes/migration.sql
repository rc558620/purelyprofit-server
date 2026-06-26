-- Step 3: 创建 StoreInviteCode 表实现邀请码持久化（0.4）

CREATE TABLE "store_invite_codes" (
  "id"          SERIAL       PRIMARY KEY,
  "store_id"    INT          NOT NULL,
  "code"        VARCHAR(8)   NOT NULL UNIQUE, -- 8位邀请码，字符集: 0-9A-Z 去除 O/I/1
  "is_active"   BOOLEAN      NOT NULL DEFAULT TRUE,
  "used_count"  INT          NOT NULL DEFAULT 0,
  "created_at"  TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "store_invite_codes_store_id_fkey" FOREIGN KEY ("store_id")
    REFERENCES "stores"("id") ON DELETE CASCADE
);

CREATE INDEX "store_invite_codes_store_id_is_active_idx" ON "store_invite_codes"("store_id", "is_active");

-- 为现有门店回填初始邀请码
-- 采用 UUID v4 随机生成 + 字符集映射，避免原 LCG 算法的碰撞问题
-- 字符集: 23456789ABCDEFGHJKLMNPQRSTUVWXYZ (去除 0/O/I/1)

INSERT INTO "store_invite_codes" ("store_id", "code")
SELECT 
  id AS "store_id",
  -- 使用 UUID 生成随机 8 位邀请码
  UPPER(TRANSLATE(
    SUBSTRING(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 8),
    'oliOLI01',
    'AAAABBBB'
  )) AS "code"
FROM "stores"
WHERE "deleted_at" IS NULL;
