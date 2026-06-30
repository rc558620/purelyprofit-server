-- ═══════════════════════════════════════════════════════════
-- P1: 搜索与排序索引优化
-- ═══════════════════════════════════════════════════════════

-- ── marketing_customers ────────────────────────────────────
-- 新增：(store_id, updated_at DESC, id DESC) 覆盖顾客列表排序
-- 现有 storeId+updatedAt 二列索引被新三列索引前缀覆盖，可安全删除
-- 现有 storeId+tier+updatedAt 三列索引仍保留（覆盖 tier 筛选场景）
DROP INDEX IF EXISTS "marketing_customers_store_id_updated_at_idx";

CREATE INDEX "marketing_customers_store_id_updated_at_id_idx"
  ON "marketing_customers" (
    "store_id",
    "updated_at" DESC,
    "id" DESC
  );

-- ── space_sessions: 补 guestName trgm 索引 ────────────────
-- 空间会话按 guestName 模糊搜索（contains insensitive），
-- 普通索引无法覆盖，需 GIN trgm 索引加速
CREATE INDEX IF NOT EXISTS "space_sessions_guest_name_trgm_idx"
  ON "space_sessions"
  USING GIN (COALESCE(guest_name, '') gin_trgm_ops);

-- ── space_sessions: 补 guestPhone 前缀索引 ────────────────
-- guestPhone 改为 startsWith 后，B-tree 索引即可覆盖
-- 与 storeId 复合，加速门店维度的手机号前缀搜索
CREATE INDEX IF NOT EXISTS "space_sessions_store_id_guest_phone_idx"
  ON "space_sessions" ("store_id", "guest_phone");

-- ── spaces: 补 name trgm 索引 ─────────────────────────────
-- 空间会话按 space.name 模糊搜索（contains insensitive），
-- 需 GIN trgm 索引加速
CREATE INDEX IF NOT EXISTS "spaces_name_trgm_idx"
  ON "spaces"
  USING GIN (name gin_trgm_ops);

-- ── marketing_customers: phone 前缀索引已有 ───────────────
-- 现有 @@index([storeId, phone]) 已覆盖 startsWith 前缀搜索，无需新增
