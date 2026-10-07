/* ── 22 条全量索引改造为 partialIndex（S3 审计）─────────────────
 * 每条改造分两步：① 新建 partial 索引 CONCURRENTLY → ② DROP 旧全量索引 CONCURRENTLY
 * 分两步避免执行期间该查询路径完全无索引可用。
 *
 * partial 条件 WHERE deleted_at IS NULL 与代码中实际查询的 WHERE 一致，
 * 已回到源码逐条核对。
 *
 * 时区假设：本批不涉及时间列索引的时区转换。deleted_at IS NULL 是布尔条件，
 * 不含时间运算。
 *
 * 回滚：见 migration_rollback.sql
 */

-- ═══════════════════════════════════════════════════════════
-- Member（3 条，members.prisma:53-55）
-- ═══════════════════════════════════════════════════════════

-- 1. Member [storeId, updatedAt]
CREATE INDEX CONCURRENTLY IF NOT EXISTS "members_store_id_updated_at_partial_idx"
  ON "members" ("store_id", "updated_at") WHERE "deleted_at" IS NULL;
DROP INDEX CONCURRENTLY IF EXISTS "members_store_id_updated_at_idx";

-- 2. Member [storeId, status, updatedAt]
CREATE INDEX CONCURRENTLY IF NOT EXISTS "members_store_id_status_updated_at_partial_idx"
  ON "members" ("store_id", "status", "updated_at") WHERE "deleted_at" IS NULL;
DROP INDEX CONCURRENTLY IF EXISTS "members_store_id_status_updated_at_idx";

-- 3. Member [storeId, isPartner, updatedAt]
CREATE INDEX CONCURRENTLY IF NOT EXISTS "members_store_id_is_partner_updated_at_partial_idx"
  ON "members" ("store_id", "is_partner", "updated_at") WHERE "deleted_at" IS NULL;
DROP INDEX CONCURRENTLY IF EXISTS "members_store_id_is_partner_updated_at_idx";

-- ═══════════════════════════════════════════════════════════
-- MarketingCustomer（5 条，customers.prisma:43-47）
-- ═══════════════════════════════════════════════════════════

-- 4. MarketingCustomer [storeId, phone]
CREATE INDEX CONCURRENTLY IF NOT EXISTS "marketing_customers_store_id_phone_partial_idx"
  ON "marketing_customers" ("store_id", "phone") WHERE "deleted_at" IS NULL;
DROP INDEX CONCURRENTLY IF EXISTS "marketing_customers_store_id_phone_idx";

-- 5. MarketingCustomer [storeId, externalIdentifier]
CREATE INDEX CONCURRENTLY IF NOT EXISTS "marketing_customers_store_id_external_identifier_partial_idx"
  ON "marketing_customers" ("store_id", "external_identifier") WHERE "deleted_at" IS NULL;
DROP INDEX CONCURRENTLY IF EXISTS "marketing_customers_store_id_external_identifier_idx";

-- 6. MarketingCustomer [storeId, updatedAt DESC, id DESC]
CREATE INDEX CONCURRENTLY IF NOT EXISTS "marketing_customers_store_id_updated_at_id_partial_idx"
  ON "marketing_customers" ("store_id", "updated_at" DESC, "id" DESC) WHERE "deleted_at" IS NULL;
DROP INDEX CONCURRENTLY IF EXISTS "marketing_customers_store_id_updated_at_id_idx";

-- 7. MarketingCustomer [storeId, tier, updatedAt]
CREATE INDEX CONCURRENTLY IF NOT EXISTS "marketing_customers_store_id_tier_updated_at_partial_idx"
  ON "marketing_customers" ("store_id", "tier", "updated_at") WHERE "deleted_at" IS NULL;
DROP INDEX CONCURRENTLY IF EXISTS "marketing_customers_store_id_tier_updated_at_idx";

-- 8. MarketingCustomer [storeId, lastVisitAt]
CREATE INDEX CONCURRENTLY IF NOT EXISTS "marketing_customers_store_id_last_visit_at_partial_idx"
  ON "marketing_customers" ("store_id", "last_visit_at") WHERE "deleted_at" IS NULL;
DROP INDEX CONCURRENTLY IF EXISTS "marketing_customers_store_id_last_visit_at_idx";

-- ═══════════════════════════════════════════════════════════
-- Product（3 条，catalog.prisma:45-47）
-- ═══════════════════════════════════════════════════════════

-- 9. Product [storeId, code]
CREATE INDEX CONCURRENTLY IF NOT EXISTS "products_store_id_code_partial_idx"
  ON "products" ("store_id", "code") WHERE "deleted_at" IS NULL;
DROP INDEX CONCURRENTLY IF EXISTS "products_store_id_code_idx";

-- 10. Product [storeId, category, updatedAt]
CREATE INDEX CONCURRENTLY IF NOT EXISTS "products_store_id_category_updated_at_partial_idx"
  ON "products" ("store_id", "category", "updated_at") WHERE "deleted_at" IS NULL;
DROP INDEX CONCURRENTLY IF EXISTS "products_store_id_category_updated_at_idx";

-- 11. Product [storeId, isActive, updatedAt]
CREATE INDEX CONCURRENTLY IF NOT EXISTS "products_store_id_is_active_updated_at_partial_idx"
  ON "products" ("store_id", "is_active", "updated_at") WHERE "deleted_at" IS NULL;
DROP INDEX CONCURRENTLY IF EXISTS "products_store_id_is_active_updated_at_idx";

-- ═══════════════════════════════════════════════════════════
-- ProductCategory（2 条，catalog.prisma:13-14）
-- ═══════════════════════════════════════════════════════════

-- 12. ProductCategory [storeId, name]
CREATE INDEX CONCURRENTLY IF NOT EXISTS "product_categories_store_id_name_partial_idx"
  ON "product_categories" ("store_id", "name") WHERE "deleted_at" IS NULL;
DROP INDEX CONCURRENTLY IF EXISTS "product_categories_store_id_name_idx";

-- 13. ProductCategory [storeId, updatedAt]
CREATE INDEX CONCURRENTLY IF NOT EXISTS "product_categories_store_id_updated_at_partial_idx"
  ON "product_categories" ("store_id", "updated_at") WHERE "deleted_at" IS NULL;
DROP INDEX CONCURRENTLY IF EXISTS "product_categories_store_id_updated_at_idx";

-- ═══════════════════════════════════════════════════════════
-- Space（4 条，spaces.prisma:52-55）
-- ═══════════════════════════════════════════════════════════

-- 14. Space [storeId, name]
CREATE INDEX CONCURRENTLY IF NOT EXISTS "spaces_store_id_name_partial_idx"
  ON "spaces" ("store_id", "name") WHERE "deleted_at" IS NULL;
DROP INDEX CONCURRENTLY IF EXISTS "spaces_store_id_name_idx";

-- 15. Space [storeId, sortOrder]
CREATE INDEX CONCURRENTLY IF NOT EXISTS "spaces_store_id_sort_order_partial_idx"
  ON "spaces" ("store_id", "sort_order") WHERE "deleted_at" IS NULL;
DROP INDEX CONCURRENTLY IF EXISTS "spaces_store_id_sort_order_idx";

-- 16. Space [storeId, typeId, sortOrder]
CREATE INDEX CONCURRENTLY IF NOT EXISTS "spaces_store_id_type_id_sort_order_partial_idx"
  ON "spaces" ("store_id", "type_id", "sort_order") WHERE "deleted_at" IS NULL;
DROP INDEX CONCURRENTLY IF EXISTS "spaces_store_id_type_id_sort_order_idx";

-- 17. Space [storeId, zoneId, sortOrder]
CREATE INDEX CONCURRENTLY IF NOT EXISTS "spaces_store_id_zone_id_sort_order_partial_idx"
  ON "spaces" ("store_id", "zone_id", "sort_order") WHERE "deleted_at" IS NULL;
DROP INDEX CONCURRENTLY IF EXISTS "spaces_store_id_zone_id_sort_order_idx";

-- ═══════════════════════════════════════════════════════════
-- Employee（4 条，employees.prisma:67-70）
-- ═══════════════════════════════════════════════════════════

-- 18. Employee [storeId, empNo]
CREATE INDEX CONCURRENTLY IF NOT EXISTS "employees_store_id_emp_no_partial_idx"
  ON "employees" ("store_id", "emp_no") WHERE "deleted_at" IS NULL;
DROP INDEX CONCURRENTLY IF EXISTS "employees_store_id_emp_no_idx";

-- 19. Employee [storeId, status, updatedAt]
CREATE INDEX CONCURRENTLY IF NOT EXISTS "employees_store_id_status_updated_at_partial_idx"
  ON "employees" ("store_id", "status", "updated_at") WHERE "deleted_at" IS NULL;
DROP INDEX CONCURRENTLY IF EXISTS "employees_store_id_status_updated_at_idx";

-- 20. Employee [storeId, department, updatedAt]
CREATE INDEX CONCURRENTLY IF NOT EXISTS "employees_store_id_department_updated_at_partial_idx"
  ON "employees" ("store_id", "department", "updated_at") WHERE "deleted_at" IS NULL;
DROP INDEX CONCURRENTLY IF EXISTS "employees_store_id_department_updated_at_idx";

-- 21. Employee [storeId, position, updatedAt]
CREATE INDEX CONCURRENTLY IF NOT EXISTS "employees_store_id_position_updated_at_partial_idx"
  ON "employees" ("store_id", "position", "updated_at") WHERE "deleted_at" IS NULL;
DROP INDEX CONCURRENTLY IF EXISTS "employees_store_id_position_updated_at_idx";

-- ═══════════════════════════════════════════════════════════
-- CommissionService（1 条，commission.prisma:21）
-- ═══════════════════════════════════════════════════════════

-- 22. CommissionService [storeId, enabled, sortOrder]
CREATE INDEX CONCURRENTLY IF NOT EXISTS "commission_services_store_id_enabled_sort_order_partial_idx"
  ON "commission_services" ("store_id", "enabled", "sort_order") WHERE "deleted_at" IS NULL;
DROP INDEX CONCURRENTLY IF EXISTS "commission_services_store_id_enabled_sort_order_idx";
