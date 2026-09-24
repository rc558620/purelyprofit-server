-- 空间码 token 改为「哈希查表」：新增 token_hash（解析查表）、token_ciphertext
-- （重新出图所需的加密明文）、token_prefix（排查用）。三列均可空，
-- 历史行由 scripts/backfill-space-qr-token-hash.mjs 回填。
--
-- ⚠️ 本次只做加法，token 明文列保留不动：
--   1. 写入侧同时写明文与 hash/密文，随时可回滚；
--   2. 解析侧走「按 hash 命中 OR（明文命中且该行未回填）」的双读；
--   3. 回填完成后不再有 token_hash 为空的行，明文分支自然失效 ——
--      即使整库泄漏，拿到的明文 token 也匹配不上，安全性当场生效；
--   4. 删除 token 列是不可逆操作，留到确认回填无误后单独做（届时一并移除
--      双读里的明文分支）。

ALTER TABLE "space_qr_codes"
  ADD COLUMN IF NOT EXISTS "token_hash" VARCHAR(128),
  ADD COLUMN IF NOT EXISTS "token_ciphertext" TEXT,
  ADD COLUMN IF NOT EXISTS "token_prefix" VARCHAR(16);

CREATE INDEX IF NOT EXISTS "space_qr_codes_token_hash_idx"
  ON "space_qr_codes"("token_hash");
