-- 删除空间码明文 token 列（⚠️ 不可逆）
--
-- 前置条件（缺一不可，否则历史空间码会永久无法重新出图）：
--   1. 迁移 20260927093000_add_space_qr_token_hash 已应用；
--   2. `pnpm space:qr:backfill` 已跑完，复跑 dry-run 显示「待回填摘要 0 / 待回填密文 0」
--      —— 即每一行的 token_hash 与 token_ciphertext 都已就绪；
--   3. SPACE_QR_TOKEN_ENCRYPTION_KEY 已显式配置且已留存到部署环境
--      （密文是用它加密的，丢了就再也解不开）；
--   4. 真机验证通过：扫历史空间码能进呼叫服务 / 自助下单，商家端预览下载能出图。
--
-- 删除后：解析只走 token_hash；重新出图只走 token_ciphertext。
-- 明文一旦消失就再也拿不回来，回滚只能靠备份。

ALTER TABLE "space_qr_codes"
  DROP COLUMN IF EXISTS "token";
