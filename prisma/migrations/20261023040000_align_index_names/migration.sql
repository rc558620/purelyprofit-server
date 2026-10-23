/*
 * 索引命名对齐（合并替代 20261023020000 / 20261023030000 两条修正迁移）。
 *
 * 背景：迁移 20261015100000_add_indexes_for_s8 用手写 SQL 建索引时带了
 * *_partial_idx 后缀（如 sale_order_items_store_id_order_id_partial_idx），
 * 而 Prisma 依据 schema.prisma 推导出的默认名不带该后缀。开发库已经落到
 * 「无 partial 后缀」的命名，导致 migrate dev 判定 drift 并要求 reset。
 *
 * 本迁移把命名差异一次性写进迁移历史，使「迁移历史推演结果」= 线上实际结构。
 * 只做重命名，不涉及任何表数据变更；已在线上/CI 执行时幂等由 DB 自身保证
 * （缺对象时报错说明该环境结构与本基线不同，需先核对）。
 */

ALTER INDEX "sale_order_items_store_id_order_id_partial_idx" RENAME TO "sale_order_items_store_id_order_id_idx";

ALTER INDEX "commission_services_store_id_enabled_sort_order_partial_idx" RENAME TO "commission_services_store_id_enabled_sort_order_idx";
ALTER INDEX "cost_records_store_source_payroll_idx" RENAME TO "cost_records_store_id_source_type_payroll_id_idx";
ALTER INDEX "employees_store_id_department_updated_at_partial_idx" RENAME TO "employees_store_id_department_updated_at_idx";
ALTER INDEX "employees_store_id_emp_no_partial_idx" RENAME TO "employees_store_id_emp_no_idx";
ALTER INDEX "employees_store_id_position_updated_at_partial_idx" RENAME TO "employees_store_id_position_updated_at_idx";
ALTER INDEX "employees_store_id_status_updated_at_partial_idx" RENAME TO "employees_store_id_status_updated_at_idx";
ALTER INDEX "finance_account_records_store_id_remaining_open_idx" RENAME TO "finance_account_records_store_id_remaining_idx";
ALTER INDEX "marketing_customers_store_id_external_identifier_partial_idx" RENAME TO "marketing_customers_store_id_external_identifier_idx";
ALTER INDEX "marketing_customers_store_id_last_visit_at_partial_idx" RENAME TO "marketing_customers_store_id_last_visit_at_idx";
ALTER INDEX "marketing_customers_store_id_phone_partial_idx" RENAME TO "marketing_customers_store_id_phone_idx";
ALTER INDEX "marketing_customers_store_id_tier_updated_at_partial_idx" RENAME TO "marketing_customers_store_id_tier_updated_at_idx";
ALTER INDEX "marketing_customers_store_id_updated_at_id_partial_idx" RENAME TO "marketing_customers_store_id_updated_at_id_idx";
ALTER INDEX "members_store_id_is_partner_updated_at_partial_idx" RENAME TO "members_store_id_is_partner_updated_at_idx";
ALTER INDEX "members_store_id_status_updated_at_partial_idx" RENAME TO "members_store_id_status_updated_at_idx";
ALTER INDEX "members_store_id_updated_at_partial_idx" RENAME TO "members_store_id_updated_at_idx";
ALTER INDEX "product_categories_store_id_name_partial_idx" RENAME TO "product_categories_store_id_name_idx";
ALTER INDEX "product_categories_store_id_updated_at_partial_idx" RENAME TO "product_categories_store_id_updated_at_idx";
ALTER INDEX "products_store_id_category_updated_at_partial_idx" RENAME TO "products_store_id_category_updated_at_idx";
ALTER INDEX "products_store_id_code_partial_idx" RENAME TO "products_store_id_code_idx";
ALTER INDEX "products_store_id_is_active_updated_at_partial_idx" RENAME TO "products_store_id_is_active_updated_at_idx";
ALTER INDEX "spaces_store_id_name_partial_idx" RENAME TO "spaces_store_id_name_idx";
ALTER INDEX "spaces_store_id_sort_order_partial_idx" RENAME TO "spaces_store_id_sort_order_idx";
ALTER INDEX "spaces_store_id_type_id_sort_order_partial_idx" RENAME TO "spaces_store_id_type_id_sort_order_idx";
ALTER INDEX "spaces_store_id_zone_id_sort_order_partial_idx" RENAME TO "spaces_store_id_zone_id_sort_order_idx";
