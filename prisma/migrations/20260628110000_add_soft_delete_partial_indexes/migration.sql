-- ═══════════════════════════════════════════════════════════
-- 软删除表 Partial List Index
-- 目的：为所有含 deleted_at 字段的列表查询补 WHERE deleted_at IS NULL
-- 的 partial index，确保软删除过滤走索引而非全表扫描
-- ═══════════════════════════════════════════════════════════

-- ── products ────────────────────────────────────────────────
-- 产品列表（按更新时间排序）
CREATE INDEX CONCURRENTLY IF NOT EXISTS "products_store_id_updated_at_id_partial_idx"
  ON "products" ("store_id", "updated_at" DESC, "id" DESC)
  WHERE "deleted_at" IS NULL;

-- 库存列表（仅活跃产品）
CREATE INDEX CONCURRENTLY IF NOT EXISTS "products_store_id_is_active_updated_at_id_partial_idx"
  ON "products" ("store_id", "is_active", "updated_at" DESC, "id" DESC)
  WHERE "deleted_at" IS NULL;

-- ── product_categories ─────────────────────────────────────
-- 分类列表（按更新时间排序）
CREATE INDEX CONCURRENTLY IF NOT EXISTS "product_categories_store_id_updated_at_id_partial_idx"
  ON "product_categories" ("store_id", "updated_at" DESC, "id" DESC)
  WHERE "deleted_at" IS NULL;

-- ── employees ──────────────────────────────────────────────
-- 员工列表（按创建时间排序）
CREATE INDEX CONCURRENTLY IF NOT EXISTS "employees_store_id_created_at_id_partial_idx"
  ON "employees" ("store_id", "created_at" DESC, "id" DESC)
  WHERE "deleted_at" IS NULL;

-- 员工列表（按状态+创建时间排序，含 status 过滤）
CREATE INDEX CONCURRENTLY IF NOT EXISTS "employees_store_id_status_created_at_id_partial_idx"
  ON "employees" ("store_id", "status", "created_at" DESC, "id" DESC)
  WHERE "deleted_at" IS NULL;

-- ── spaces ─────────────────────────────────────────────────
-- 空间列表（按排序+创建时间）
CREATE INDEX CONCURRENTLY IF NOT EXISTS "spaces_store_id_sort_order_created_at_id_partial_idx"
  ON "spaces" ("store_id", "sort_order", "created_at", "id")
  WHERE "deleted_at" IS NULL;

-- ── store_partners ─────────────────────────────────────────
-- 合伙人列表（按审核时间排序，仅 approved）
CREATE INDEX CONCURRENTLY IF NOT EXISTS "store_partners_store_id_status_reviewed_at_id_partial_idx"
  ON "store_partners" ("store_id", "status", "reviewed_at" DESC, "id" DESC)
  WHERE "deleted_at" IS NULL;

-- ── marketing_customers ────────────────────────────────────
-- 顾客列表（覆盖带 deletedAt: null 的查询，与已有非 partial 索引互补）
CREATE INDEX CONCURRENTLY IF NOT EXISTS "marketing_customers_store_id_updated_at_id_partial_idx"
  ON "marketing_customers" ("store_id", "updated_at" DESC, "id" DESC)
  WHERE "deleted_at" IS NULL;

-- ── stores ─────────────────────────────────────────────────
-- 按 owner 查门店
CREATE INDEX CONCURRENTLY IF NOT EXISTS "stores_owner_id_updated_at_id_partial_idx"
  ON "stores" ("owner_id", "updated_at" DESC, "id" DESC)
  WHERE "deleted_at" IS NULL;
