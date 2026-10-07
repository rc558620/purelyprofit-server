/* 回滚：恢复 22 条全量索引 + 删除 22 条 partial 索引
 * 每条回滚 = ① CREATE 旧全量索引 CONCURRENTLY → ② DROP partial 索引 CONCURRENTLY
 * 执行顺序与正向迁移相反 */

-- 22. CommissionService [storeId, enabled, sortOrder]
CREATE INDEX CONCURRENTLY IF NOT EXISTS "commission_services_store_id_enabled_sort_order_idx"
  ON "commission_services" ("store_id", "enabled", "sort_order");
DROP INDEX CONCURRENTLY IF EXISTS "commission_services_store_id_enabled_sort_order_partial_idx";

-- 21. Employee [storeId, position, updatedAt]
CREATE INDEX CONCURRENTLY IF NOT EXISTS "employees_store_id_position_updated_at_idx"
  ON "employees" ("store_id", "position", "updated_at");
DROP INDEX CONCURRENTLY IF EXISTS "employees_store_id_position_updated_at_partial_idx";

-- 20. Employee [storeId, department, updatedAt]
CREATE INDEX CONCURRENTLY IF NOT EXISTS "employees_store_id_department_updated_at_idx"
  ON "employees" ("store_id", "department", "updated_at");
DROP INDEX CONCURRENTLY IF EXISTS "employees_store_id_department_updated_at_partial_idx";

-- 19. Employee [storeId, status, updatedAt]
CREATE INDEX CONCURRENTLY IF NOT EXISTS "employees_store_id_status_updated_at_idx"
  ON "employees" ("store_id", "status", "updated_at");
DROP INDEX CONCURRENTLY IF EXISTS "employees_store_id_status_updated_at_partial_idx";

-- 18. Employee [storeId, empNo]
CREATE INDEX CONCURRENTLY IF NOT EXISTS "employees_store_id_emp_no_idx"
  ON "employees" ("store_id", "emp_no");
DROP INDEX CONCURRENTLY IF EXISTS "employees_store_id_emp_no_partial_idx";

-- 17. Space [storeId, zoneId, sortOrder]
CREATE INDEX CONCURRENTLY IF NOT EXISTS "spaces_store_id_zone_id_sort_order_idx"
  ON "spaces" ("store_id", "zone_id", "sort_order");
DROP INDEX CONCURRENTLY IF EXISTS "spaces_store_id_zone_id_sort_order_partial_idx";

-- 16. Space [storeId, typeId, sortOrder]
CREATE INDEX CONCURRENTLY IF NOT EXISTS "spaces_store_id_type_id_sort_order_idx"
  ON "spaces" ("store_id", "type_id", "sort_order");
DROP INDEX CONCURRENTLY IF EXISTS "spaces_store_id_type_id_sort_order_partial_idx";

-- 15. Space [storeId, sortOrder]
CREATE INDEX CONCURRENTLY IF NOT EXISTS "spaces_store_id_sort_order_idx"
  ON "spaces" ("store_id", "sort_order");
DROP INDEX CONCURRENTLY IF EXISTS "spaces_store_id_sort_order_partial_idx";

-- 14. Space [storeId, name]
CREATE INDEX CONCURRENTLY IF NOT EXISTS "spaces_store_id_name_idx"
  ON "spaces" ("store_id", "name");
DROP INDEX CONCURRENTLY IF EXISTS "spaces_store_id_name_partial_idx";

-- 13. ProductCategory [storeId, updatedAt]
CREATE INDEX CONCURRENTLY IF NOT EXISTS "product_categories_store_id_updated_at_idx"
  ON "product_categories" ("store_id", "updated_at");
DROP INDEX CONCURRENTLY IF EXISTS "product_categories_store_id_updated_at_partial_idx";

-- 12. ProductCategory [storeId, name]
CREATE INDEX CONCURRENTLY IF NOT EXISTS "product_categories_store_id_name_idx"
  ON "product_categories" ("store_id", "name");
DROP INDEX CONCURRENTLY IF EXISTS "product_categories_store_id_name_partial_idx";

-- 11. Product [storeId, isActive, updatedAt]
CREATE INDEX CONCURRENTLY IF NOT EXISTS "products_store_id_is_active_updated_at_idx"
  ON "products" ("store_id", "is_active", "updated_at");
DROP INDEX CONCURRENTLY IF EXISTS "products_store_id_is_active_updated_at_partial_idx";

-- 10. Product [storeId, category, updatedAt]
CREATE INDEX CONCURRENTLY IF NOT EXISTS "products_store_id_category_updated_at_idx"
  ON "products" ("store_id", "category", "updated_at");
DROP INDEX CONCURRENTLY IF EXISTS "products_store_id_category_updated_at_partial_idx";

-- 9. Product [storeId, code]
CREATE INDEX CONCURRENTLY IF NOT EXISTS "products_store_id_code_idx"
  ON "products" ("store_id", "code");
DROP INDEX CONCURRENTLY IF EXISTS "products_store_id_code_partial_idx";

-- 8. MarketingCustomer [storeId, lastVisitAt]
CREATE INDEX CONCURRENTLY IF NOT EXISTS "marketing_customers_store_id_last_visit_at_idx"
  ON "marketing_customers" ("store_id", "last_visit_at");
DROP INDEX CONCURRENTLY IF EXISTS "marketing_customers_store_id_last_visit_at_partial_idx";

-- 7. MarketingCustomer [storeId, tier, updatedAt]
CREATE INDEX CONCURRENTLY IF NOT EXISTS "marketing_customers_store_id_tier_updated_at_idx"
  ON "marketing_customers" ("store_id", "tier", "updated_at");
DROP INDEX CONCURRENTLY IF EXISTS "marketing_customers_store_id_tier_updated_at_partial_idx";

-- 6. MarketingCustomer [storeId, updatedAt DESC, id DESC]
CREATE INDEX CONCURRENTLY IF NOT EXISTS "marketing_customers_store_id_updated_at_id_idx"
  ON "marketing_customers" ("store_id", "updated_at" DESC, "id" DESC);
DROP INDEX CONCURRENTLY IF EXISTS "marketing_customers_store_id_updated_at_id_partial_idx";

-- 5. MarketingCustomer [storeId, externalIdentifier]
CREATE INDEX CONCURRENTLY IF NOT EXISTS "marketing_customers_store_id_external_identifier_idx"
  ON "marketing_customers" ("store_id", "external_identifier");
DROP INDEX CONCURRENTLY IF EXISTS "marketing_customers_store_id_external_identifier_partial_idx";

-- 4. MarketingCustomer [storeId, phone]
CREATE INDEX CONCURRENTLY IF NOT EXISTS "marketing_customers_store_id_phone_idx"
  ON "marketing_customers" ("store_id", "phone");
DROP INDEX CONCURRENTLY IF EXISTS "marketing_customers_store_id_phone_partial_idx";

-- 3. Member [storeId, isPartner, updatedAt]
CREATE INDEX CONCURRENTLY IF NOT EXISTS "members_store_id_is_partner_updated_at_idx"
  ON "members" ("store_id", "is_partner", "updated_at");
DROP INDEX CONCURRENTLY IF EXISTS "members_store_id_is_partner_updated_at_partial_idx";

-- 2. Member [storeId, status, updatedAt]
CREATE INDEX CONCURRENTLY IF NOT EXISTS "members_store_id_status_updated_at_idx"
  ON "members" ("store_id", "status", "updated_at");
DROP INDEX CONCURRENTLY IF EXISTS "members_store_id_status_updated_at_partial_idx";

-- 1. Member [storeId, updatedAt]
CREATE INDEX CONCURRENTLY IF NOT EXISTS "members_store_id_updated_at_idx"
  ON "members" ("store_id", "updated_at");
DROP INDEX CONCURRENTLY IF EXISTS "members_store_id_updated_at_partial_idx";
