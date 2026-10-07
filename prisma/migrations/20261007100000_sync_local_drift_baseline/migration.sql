/*
 * Drift 收编基线（baseline）。
 *
 * 来历：schema.prisma 曾被直接修改（stores 删 wechat_* 四列、加 business_timezone 等）
 * 而未生成 migration，同时本地开发库也被手工改过（缺 marketing_promotions.business_modes、
 * 多 scan_ordering_types 等对象），导致 `prisma migrate dev` 检测到 drift 并要求
 * reset 整库。本迁移把「migration 累积结构 → 实际库当前结构」的差异固化为历史，
 * 使 migration 链重新与真实结构对齐。
 *
 * ⚠️ 应用方式特殊：本地库已是本迁移的目标状态，因此本地**只登记不执行**
 * （prisma migrate resolve --applied）。其他环境（生产/CI）deploy 时会真实执行，
 * 执行前请先在预发验证；其中 DROP 语句已改为 IF EXISTS，避免对象缺失时中断迁移链。
 *
 * DROP 的对象均为有意删除：
 * - marketing_promotions.business_modes / stores.wechat_*：schema.prisma 已不存在这些列
 * - 两张 store_new_customer_quota_consumes_*_{date} 表：20260928 / 20261006 两条
 *   运维迁移创建的一次性修复产物，使命已完成
 *
 * 生成方式：prisma migrate diff --from-migrations --to-config-datasource --script，
 * 之后仅将 DROP 语句手工幂等化。
 */

-- CreateEnum
CREATE TYPE "public"."StoreIndustry" AS ENUM ('retail', 'catering', 'beauty', 'fitness', 'entertainment', 'service', 'other');

-- AlterEnum
BEGIN;
CREATE TYPE "public"."MarketingCustomerTier_new" AS ENUM ('regular', 'gold', 'diamond');
ALTER TABLE "public"."marketing_customers" ALTER COLUMN "tier" DROP DEFAULT;
ALTER TABLE "public"."marketing_customers" ALTER COLUMN "tier" TYPE "public"."MarketingCustomerTier_new" USING ("tier"::text::"public"."MarketingCustomerTier_new");
ALTER TYPE "public"."MarketingCustomerTier" RENAME TO "MarketingCustomerTier_old";
ALTER TYPE "public"."MarketingCustomerTier_new" RENAME TO "MarketingCustomerTier";
DROP TYPE "public"."MarketingCustomerTier_old";
ALTER TABLE "public"."marketing_customers" ALTER COLUMN "tier" SET DEFAULT 'regular';
COMMIT;

-- DropForeignKey
ALTER TABLE "public"."cost_records" DROP CONSTRAINT "cost_records_payroll_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."cost_records" DROP CONSTRAINT "cost_records_purchase_order_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."finance_cash_flow_records" DROP CONSTRAINT "finance_cash_flow_records_sale_order_refund_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."inventory_adjustment_logs" DROP CONSTRAINT "inventory_adjustment_logs_product_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."sale_orders" DROP CONSTRAINT "sale_orders_scan_order_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."scan_order_balance_transactions" DROP CONSTRAINT "scan_order_balance_transactions_order_id_fkey";

-- DropIndex
DROP INDEX "public"."cost_records_store_id_source_type_payroll_id_key";

-- DropIndex
DROP INDEX "public"."cost_records_store_id_source_type_purchase_order_id_key";

-- DropIndex
DROP INDEX "public"."cost_records_store_source_payroll_unique";

-- DropIndex
DROP INDEX "public"."cost_records_store_source_purchase_unique";

-- DropIndex
DROP INDEX "public"."employees_store_id_created_at_id_partial_idx";

-- DropIndex
DROP INDEX "public"."employees_store_id_emp_no_partial_key";

-- DropIndex
DROP INDEX "public"."employees_store_id_status_created_at_id_partial_idx";

-- DropIndex
DROP INDEX "public"."idx_marketing_customers_club_user";

-- DropIndex
DROP INDEX "public"."marketing_customers_member_id_key";

-- DropIndex
DROP INDEX "public"."marketing_customers_store_id_external_partial_key";

-- DropIndex
DROP INDEX "public"."marketing_customers_store_id_phone_partial_key";

-- DropIndex
DROP INDEX "public"."marketing_customers_store_id_updated_at_id_partial_idx";

-- DropIndex
DROP INDEX "public"."marketing_promotions_store_type_enabled_uniq";

-- DropIndex
DROP INDEX "public"."members_customer_id_key";

-- DropIndex
DROP INDEX "public"."members_store_id_deleted_at_idx";

-- DropIndex
DROP INDEX "public"."members_store_id_phone_partial_key";

-- DropIndex
DROP INDEX "public"."product_categories_store_id_name_partial_key";

-- DropIndex
DROP INDEX "public"."product_categories_store_id_updated_at_id_partial_idx";

-- DropIndex
DROP INDEX "public"."products_store_id_code_partial_key";

-- DropIndex
DROP INDEX "public"."products_store_id_is_active_updated_at_id_partial_idx";

-- DropIndex
DROP INDEX "public"."products_store_id_updated_at_id_partial_idx";

-- DropIndex
DROP INDEX "public"."uq_scan_order_refund_task_active";

-- DropIndex
DROP INDEX "public"."idx_scan_ordering_sessions_history";

-- DropIndex
DROP INDEX "public"."idx_scan_ordering_spec_group_menu_product_active_sort";

-- DropIndex
DROP INDEX "public"."idx_scan_ordering_spec_option_group_active_sort";

-- DropIndex
DROP INDEX "public"."scan_ordering_tables_store_id_table_code_key";

-- DropIndex
DROP INDEX "public"."service_calls_store_status_last_requested_at_idx";

-- DropIndex
DROP INDEX "public"."spaces_name_trgm_idx";

-- DropIndex
DROP INDEX "public"."spaces_store_id_name_partial_key";

-- DropIndex
DROP INDEX "public"."spaces_store_id_sort_order_created_at_id_partial_idx";

-- DropIndex
DROP INDEX "public"."staffs_active_email_unique";

-- DropIndex
DROP INDEX "public"."store_membership_orders_payment_order_id_key";

-- DropIndex
DROP INDEX "public"."store_partners_store_id_id_card_unique_partial_idx";

-- DropIndex
DROP INDEX "public"."store_partners_store_id_phone_unique_partial_idx";

-- DropIndex
DROP INDEX "public"."store_partners_store_id_status_reviewed_at_id_partial_idx";

-- DropIndex
DROP INDEX "public"."stores_deleted_at_idx";

-- DropIndex
DROP INDEX "public"."stores_owner_id_updated_at_id_partial_idx";

-- AlterTable
ALTER TABLE "public"."employee_payrolls" ALTER COLUMN "social_insurance" SET NOT NULL,
ALTER COLUMN "social_insurance" SET DEFAULT 0,
ALTER COLUMN "social_insurance" SET DATA TYPE INTEGER,
ALTER COLUMN "housing_fund" SET NOT NULL,
ALTER COLUMN "housing_fund" SET DEFAULT 0,
ALTER COLUMN "housing_fund" SET DATA TYPE INTEGER;

-- AlterTable
ALTER TABLE "public"."marketing_promotions" DROP COLUMN IF EXISTS "business_modes";

-- AlterTable
ALTER TABLE "public"."scan_order_balance_transactions" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "public"."scan_ordering_tables" ADD COLUMN     "type_id" INTEGER;

-- AlterTable
ALTER TABLE "public"."store_membership_points_logs" ALTER COLUMN "change_type" DROP DEFAULT;

-- AlterTable
ALTER TABLE "public"."stores" DROP COLUMN IF EXISTS "wechat_api_v3_key",
DROP COLUMN IF EXISTS "wechat_configured_at",
DROP COLUMN IF EXISTS "wechat_mch_id",
DROP COLUMN IF EXISTS "wechat_mch_name",
ADD COLUMN     "business_timezone" TEXT NOT NULL DEFAULT 'Asia/Shanghai',
ADD COLUMN     "industry_code" "public"."StoreIndustry" NOT NULL DEFAULT 'other',
ADD COLUMN     "scan_ordering_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "scan_ordering_enabled_at" TIMESTAMP(3);

-- DropTable
DROP TABLE IF EXISTS "public"."store_new_customer_quota_consumes_deduped_20261006";

-- DropTable
DROP TABLE IF EXISTS "public"."store_new_customer_quota_consumes_unresolved_20260928";

-- CreateTable
CREATE TABLE "public"."scan_ordering_types" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scan_ordering_types_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scan_ordering_types_store_id_idx" ON "public"."scan_ordering_types"("store_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "scan_ordering_types_store_id_name_key" ON "public"."scan_ordering_types"("store_id" ASC, "name" ASC);

-- CreateIndex
CREATE INDEX "employees_department_id_idx" ON "public"."employees"("department_id" ASC);

-- CreateIndex
CREATE INDEX "employees_position_id_idx" ON "public"."employees"("position_id" ASC);

-- CreateIndex
CREATE INDEX "marketing_consumptions_promotion_id_idx" ON "public"."marketing_consumptions"("promotion_id" ASC);

-- CreateIndex
CREATE INDEX "marketing_consumptions_store_id_customer_id_created_at_idx" ON "public"."marketing_consumptions"("store_id" ASC, "customer_id" ASC, "created_at" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "marketing_customers_member_id_key" ON "public"."marketing_customers"("member_id" ASC);

-- CreateIndex
CREATE INDEX "marketing_recharges_promotion_id_idx" ON "public"."marketing_recharges"("promotion_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "members_customer_id_key" ON "public"."members"("customer_id" ASC);

-- CreateIndex
CREATE INDEX "sale_orders_store_id_created_at_idx" ON "public"."sale_orders"("store_id" ASC, "created_at" ASC);

