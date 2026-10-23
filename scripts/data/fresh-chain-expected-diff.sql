-- DropIndex
DROP INDEX "products_category_trgm_idx";

-- DropIndex
DROP INDEX "products_code_trgm_idx";

-- DropIndex
DROP INDEX "products_name_trgm_idx";

-- DropIndex
DROP INDEX "sale_order_items_store_id_order_id_idx";

-- DropIndex
DROP INDEX "uq_scan_order_refund_task_active";

-- DropIndex
DROP INDEX "idx_service_calls_store_open";

-- DropIndex
DROP INDEX "uq_service_calls_club_user_store_type_open";

-- DropTable
DROP TABLE "sale_order_items_archive";

-- CreateIndex
CREATE INDEX "sale_order_items_store_id_order_id_idx" ON "sale_order_items"("store_id", "order_id") WHERE (product_name NOT IN ('预付抵扣', '预付款', '续费抵扣'));

-- CreateIndex
CREATE UNIQUE INDEX "uq_scan_order_refund_task_active" ON "scan_order_refund_tasks"("order_id") WHERE ("status" IN ('pending', 'refunding', 'manual_pending'));

-- CreateIndex
CREATE INDEX "idx_service_calls_store_open" ON "service_calls"("store_id", "status", "requested_at") WHERE ("status" IN ('pending', 'processing'));

-- CreateIndex
CREATE UNIQUE INDEX "uq_service_calls_club_user_store_type_open" ON "service_calls"("club_user_id", "store_id", "type") WHERE ("status" IN ('pending', 'processing'));

