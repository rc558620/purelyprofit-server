-- ═══════════════════════════════════════════════════════════
-- StorePartner Partial Unique Index
-- 目的：确保同一门店下未删除的合伙人手机号唯一
-- ═══════════════════════════════════════════════════════════

-- ── (store_id, phone) 唯一约束 ─────────────────────────────
-- 同一门店下，未删除且手机号非空的合伙人手机号不能重复
-- phone 为 NULL 的记录不参与唯一性检查（早期微信登录无手机号场景）
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "store_partners_store_id_phone_unique_partial_idx"
  ON "store_partners" ("store_id", "phone")
  WHERE "deleted_at" IS NULL AND "phone" IS NOT NULL;

-- ── (store_id, id_card) 唯一约束 ───────────────────────────
-- 同一门店下，未删除且身份证号非空的合伙人身份证号不能重复
-- idCard 为 NULL 的记录不参与唯一性检查（早期申请未填身份证场景）
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "store_partners_store_id_id_card_unique_partial_idx"
  ON "store_partners" ("store_id", "id_card")
  WHERE "deleted_at" IS NULL AND "id_card" IS NOT NULL;
