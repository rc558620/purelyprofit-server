-- ============================================================================
-- 回滚 SQL：scan_ordering 迁移回退
-- 执行顺序：先删外键，再删索引，再删表，最后删枚举
-- ============================================================================

-- 删除外键
ALTER TABLE "scan_order_service_calls" DROP CONSTRAINT IF EXISTS "scan_order_service_calls_session_id_fkey";
ALTER TABLE "scan_order_service_calls" DROP CONSTRAINT IF EXISTS "scan_order_service_calls_table_id_fkey";
ALTER TABLE "scan_order_coupon_usages" DROP CONSTRAINT IF EXISTS "scan_order_coupon_usages_order_id_fkey";
ALTER TABLE "scan_order_payment_attempts" DROP CONSTRAINT IF EXISTS "scan_order_payment_attempts_order_id_fkey";
ALTER TABLE "scan_ordering_table_qr_codes" DROP CONSTRAINT IF EXISTS "scan_ordering_table_qr_codes_table_id_fkey";
ALTER TABLE "scan_ordering_spec_options" DROP CONSTRAINT IF EXISTS "scan_ordering_spec_options_group_id_fkey";
ALTER TABLE "scan_ordering_spec_groups" DROP CONSTRAINT IF EXISTS "scan_ordering_spec_groups_menu_product_id_fkey";
ALTER TABLE "scan_ordering_menu_products" DROP CONSTRAINT IF EXISTS "scan_ordering_menu_products_category_id_fkey";
ALTER TABLE "scan_order_status_histories" DROP CONSTRAINT IF EXISTS "scan_order_status_histories_order_id_fkey";
ALTER TABLE "scan_order_item_specs" DROP CONSTRAINT IF EXISTS "scan_order_item_specs_order_item_id_fkey";
ALTER TABLE "scan_order_items" DROP CONSTRAINT IF EXISTS "scan_order_items_order_id_fkey";
ALTER TABLE "scan_orders" DROP CONSTRAINT IF EXISTS "scan_orders_session_id_fkey";
ALTER TABLE "scan_orders" DROP CONSTRAINT IF EXISTS "scan_orders_table_id_fkey";
ALTER TABLE "scan_ordering_cart_item_specs" DROP CONSTRAINT IF EXISTS "scan_ordering_cart_item_specs_cart_item_id_fkey";
ALTER TABLE "scan_ordering_cart_items" DROP CONSTRAINT IF EXISTS "scan_ordering_cart_items_session_id_fkey";
ALTER TABLE "scan_ordering_sessions" DROP CONSTRAINT IF EXISTS "scan_ordering_sessions_table_id_fkey";
ALTER TABLE "scan_ordering_tables" DROP CONSTRAINT IF EXISTS "scan_ordering_tables_area_id_fkey";

-- 删除新增表（顺序从依赖末端到主表）
DROP TABLE IF EXISTS "idempotency_records";
DROP TABLE IF EXISTS "scan_order_service_calls";
DROP TABLE IF EXISTS "scan_order_coupon_usages";
DROP TABLE IF EXISTS "scan_order_payment_attempts";
DROP TABLE IF EXISTS "scan_ordering_table_qr_codes";
DROP TABLE IF EXISTS "scan_ordering_spec_options";
DROP TABLE IF EXISTS "scan_ordering_spec_groups";
DROP TABLE IF EXISTS "scan_ordering_menu_products";
DROP TABLE IF EXISTS "scan_ordering_menu_categories";
DROP TABLE IF EXISTS "scan_order_status_histories";
DROP TABLE IF EXISTS "scan_order_item_specs";
DROP TABLE IF EXISTS "scan_order_items";
DROP TABLE IF EXISTS "scan_orders";
DROP TABLE IF EXISTS "scan_ordering_cart_item_specs";
DROP TABLE IF EXISTS "scan_ordering_cart_items";
DROP TABLE IF EXISTS "scan_ordering_sessions";
DROP TABLE IF EXISTS "scan_ordering_tables";
DROP TABLE IF EXISTS "scan_ordering_areas";

-- 删除枚举
DROP TYPE IF EXISTS "IdempotencyRecordStatus";
DROP TYPE IF EXISTS "ScanOrderServiceCallType";
DROP TYPE IF EXISTS "ScanOrderServiceCallStatus";
DROP TYPE IF EXISTS "ScanOrderCouponUsageStatus";
DROP TYPE IF EXISTS "ScanOrderPaymentAttemptStatus";
DROP TYPE IF EXISTS "ScanOrderingQrCodeStatus";
DROP TYPE IF EXISTS "ScanOrderingSpecSelectionType";
DROP TYPE IF EXISTS "ScanOrderingStockMode";
DROP TYPE IF EXISTS "ScanOrderFulfillmentStatus";
DROP TYPE IF EXISTS "ScanOrderPaymentStatus";
DROP TYPE IF EXISTS "ScanOrderStatus";
DROP TYPE IF EXISTS "CartItemStatus";
DROP TYPE IF EXISTS "ScanOrderingSessionStatus";
DROP TYPE IF EXISTS "ScanOrderingTableStatus";
