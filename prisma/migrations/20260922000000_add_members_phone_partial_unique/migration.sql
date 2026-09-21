-- ═══════════════════════════════════════════════════════════
-- members：同门店未删除会员的手机号唯一
--
-- 背景：唯一性此前只靠 MembersService 里「事务外先查后写」保证，
--       存在 TOCTOU 窗口——并发建会员可以插入同店重复手机号。
--
-- 为什么用 partial index 而不是普通唯一索引：
--   普通唯一索引会把已软删会员的手机号也占住，与「删除会员后该号码
--   可重新注册」的语义冲突（全仓无 deletedAt 过滤中间件，删除是软删）。
--
-- 风格对齐 20260801123000_align_scan_ordering_spec_contract：
--   存在历史重复时停止迁移并给出明确指引，绝不静默删除业务数据。
-- ═══════════════════════════════════════════════════════════

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "members"
    WHERE "phone" IS NOT NULL AND "deleted_at" IS NULL
    GROUP BY "store_id", "phone"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      '存在同店重复的未删除会员手机号；请先合并或软删除重复记录后重试迁移';
  END IF;
END $$;

CREATE UNIQUE INDEX "uq_members_store_phone_active"
  ON "members" ("store_id", "phone")
  WHERE "phone" IS NOT NULL AND "deleted_at" IS NULL;
