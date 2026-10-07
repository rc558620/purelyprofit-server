/*
 * 将数据库结构对齐到 schema.prisma（drift 收编后的增量）：
 * 补齐缺失的外键与索引、删除 members(store_id, phone) 唯一约束
 * （schema 已将其改为普通索引：换绑后同号可合法存在多条历史档案）、
 * 对齐 text/varchar 类型与索引命名。无任何数据删除。
 *
 * 生成：prisma migrate diff --from-migrations --to-schema --script
 */

-- DropForeignKey
ALTER TABLE "scan_orders" DROP CONSTRAINT "scan_orders_table_id_fkey";

-- DropForeignKey
ALTER TABLE "store_invite_qr_issues" DROP CONSTRAINT "store_invite_qr_issues_invite_code_id_fkey";

-- DropForeignKey
ALTER TABLE "store_invite_qr_issues" DROP CONSTRAINT "store_invite_qr_issues_store_id_fkey";

-- DropForeignKey
ALTER TABLE "store_membership_locked_prices" DROP CONSTRAINT "store_membership_locked_prices_store_id_fkey";

-- DropIndex
DROP INDEX "uq_members_store_phone_active";

-- DropIndex
DROP INDEX "sale_orders_store_id_manual_entry_created_at_idx";

-- DropIndex
DROP INDEX "scan_orders_store_pickup_date_idx";

-- AlterTable
ALTER TABLE "print_agents" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "scan_ordering_pickup_sequences" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "scan_orders" ALTER COLUMN "pickup_assigned_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "pickup_called_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "pickup_completed_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "store_invite_qr_issues" ALTER COLUMN "channel" SET DATA TYPE TEXT,
ALTER COLUMN "name" SET DATA TYPE TEXT,
ALTER COLUMN "public_token" SET DATA TYPE TEXT,
ALTER COLUMN "protocol_version" SET DATA TYPE TEXT,
ALTER COLUMN "status" SET DATA TYPE TEXT,
ALTER COLUMN "issued_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "revoked_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "stores" ALTER COLUMN "cashier_print_channel" SET DATA TYPE TEXT,
ALTER COLUMN "kitchen_print_channel" SET DATA TYPE TEXT,
ALTER COLUMN "cashier_cloud_printer_sn" SET DATA TYPE TEXT,
ALTER COLUMN "kitchen_cloud_printer_sn" SET DATA TYPE TEXT,
ALTER COLUMN "cashier_usb_printer" SET DATA TYPE TEXT,
ALTER COLUMN "kitchen_usb_printer" SET DATA TYPE TEXT,
ALTER COLUMN "print_agent_bind_code" SET DATA TYPE TEXT,
ALTER COLUMN "print_agent_token" SET DATA TYPE TEXT;

-- CreateIndex
CREATE INDEX "sale_orders_store_id_manual_entry_created_at_idx" ON "sale_orders"("store_id", "manual_entry", "created_at");

-- CreateIndex
-- prisma migrate diff 对 raw() 部分索引渲染时吞了一个右括号，这里按 schema 的
-- 原义改写为等价的 IN 形式（与 20260731194500 等历史迁移的写法一致）
CREATE UNIQUE INDEX "uq_scan_order_refund_task_active" ON "scan_order_refund_tasks"("order_id") WHERE "status" IN ('pending', 'refunding', 'manual_pending');

-- CreateIndex
CREATE UNIQUE INDEX "uq_service_calls_club_user_store_type_open" ON "service_calls"("club_user_id", "store_id", "type") WHERE "status" IN ('pending', 'processing');

-- CreateIndex
CREATE INDEX "space_sessions_status_start_time_idx" ON "space_sessions"("status", "start_time");

-- CreateIndex
CREATE INDEX "space_sessions_status_auto_checkout_billing_mode_end_time_idx" ON "space_sessions"("status", "auto_checkout", "billing_mode", "end_time");

-- CreateIndex
CREATE UNIQUE INDEX "store_membership_orders_payment_order_id_key" ON "store_membership_orders"("payment_order_id");

-- CreateIndex
CREATE INDEX "store_membership_orders_store_id_status_created_at_idx" ON "store_membership_orders"("store_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "users_wechat_unionid_key" ON "users"("wechat_unionid");

-- AddForeignKey
ALTER TABLE "club_voucher_orders" ADD CONSTRAINT "club_voucher_orders_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "marketing_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_cash_flow_records" ADD CONSTRAINT "finance_cash_flow_records_sale_order_refund_id_fkey" FOREIGN KEY ("sale_order_refund_id") REFERENCES "sale_order_refunds"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_adjustment_logs" ADD CONSTRAINT "inventory_adjustment_logs_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_membership_locked_prices" ADD CONSTRAINT "store_membership_locked_prices_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_records" ADD CONSTRAINT "cost_records_payroll_id_fkey" FOREIGN KEY ("payroll_id") REFERENCES "employee_payrolls"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_records" ADD CONSTRAINT "cost_records_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_orders" ADD CONSTRAINT "sale_orders_scan_order_id_fkey" FOREIGN KEY ("scan_order_id") REFERENCES "scan_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scan_ordering_tables" ADD CONSTRAINT "scan_ordering_tables_type_id_fkey" FOREIGN KEY ("type_id") REFERENCES "scan_ordering_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scan_orders" ADD CONSTRAINT "scan_orders_table_id_fkey" FOREIGN KEY ("table_id") REFERENCES "scan_ordering_tables"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scan_order_items" ADD CONSTRAINT "scan_order_items_menu_product_id_fkey" FOREIGN KEY ("menu_product_id") REFERENCES "scan_ordering_menu_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scan_order_balance_transactions" ADD CONSTRAINT "scan_order_balance_transactions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "scan_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_invite_qr_issues" ADD CONSTRAINT "store_invite_qr_issues_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_invite_qr_issues" ADD CONSTRAINT "store_invite_qr_issues_invite_code_id_fkey" FOREIGN KEY ("invite_code_id") REFERENCES "store_invite_codes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "idx_scan_order_balance_transactions_customer_created" RENAME TO "scan_order_balance_transactions_customer_id_created_at_idx";

-- RenameIndex
ALTER INDEX "uq_scan_order_balance_transactions_order_type" RENAME TO "scan_order_balance_transactions_order_id_type_key";

-- RenameIndex
ALTER INDEX "scan_ordering_sessions_round_status_idx" RENAME TO "scan_ordering_sessions_dining_round_id_status_idx";

-- RenameIndex
ALTER INDEX "scan_ordering_sessions_store_table_user_round_idx" RENAME TO "scan_ordering_sessions_store_id_table_id_club_user_id_dinin_idx";

-- RenameIndex
ALTER INDEX "scan_orders_club_user_round_created_at_idx" RENAME TO "scan_orders_club_user_id_dining_round_id_created_at_idx";

-- RenameIndex
ALTER INDEX "scan_orders_store_table_round_created_at_idx" RENAME TO "scan_orders_store_id_table_id_dining_round_id_created_at_idx";

-- RenameIndex
ALTER INDEX "space_reservations_store_id_status_reserved_at_created_at_id_id" RENAME TO "space_reservations_store_id_status_reserved_at_created_at_i_idx";

-- RenameIndex
ALTER INDEX "store_membership_price_override_audits_store_id_plan_id_created" RENAME TO "store_membership_price_override_audits_store_id_plan_id_cre_idx";

