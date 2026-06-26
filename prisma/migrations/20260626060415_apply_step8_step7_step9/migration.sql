/*
  Warnings:

  - Made the column `bean_balance` on table `members` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "marketing_customers" DROP CONSTRAINT "marketing_customers_member_id_fkey";

-- DropForeignKey
ALTER TABLE "store_invite_codes" DROP CONSTRAINT "store_invite_codes_store_id_fkey";

-- DropForeignKey
ALTER TABLE "store_membership_promo_records" DROP CONSTRAINT "store_membership_promo_records_partner_id_fkey";

-- DropForeignKey
ALTER TABLE "store_wechat_pay_configs" DROP CONSTRAINT "store_wechat_pay_configs_store_id_fkey";

-- DropIndex (IF EXISTS: 这些索引在 step6 中创建，但本 migration 时间戳早于 step6，shadow DB 顺序执行时索引可能尚不存在)
DROP INDEX IF EXISTS "employee_leaves_employee_store_idx";

-- DropIndex
DROP INDEX IF EXISTS "employee_payrolls_employee_store_idx";

-- DropIndex
DROP INDEX IF EXISTS "employee_shifts_employee_store_idx";

-- DropIndex
DROP INDEX IF EXISTS "inventory_adjustment_logs_product_store_idx";

-- DropIndex
DROP INDEX IF EXISTS "marketing_consumptions_customer_store_idx";

-- DropIndex
DROP INDEX IF EXISTS "marketing_points_records_customer_store_idx";

-- DropIndex
DROP INDEX IF EXISTS "marketing_recharges_customer_store_idx";

-- DropIndex
DROP INDEX IF EXISTS "member_bean_logs_member_store_idx";

-- DropIndex
DROP INDEX IF EXISTS "member_points_logs_member_store_idx";

-- DropIndex
DROP INDEX IF EXISTS "member_recharge_logs_member_store_idx";

-- DropIndex
DROP INDEX IF EXISTS "partner_withdrawals_partner_store_idx";

-- DropIndex
DROP INDEX IF EXISTS "purchase_order_items_order_store_idx";

-- DropIndex
DROP INDEX IF EXISTS "sale_order_items_order_store_idx";

-- DropIndex
DROP INDEX IF EXISTS "space_sessions_space_store_idx";

-- DropIndex
DROP INDEX IF EXISTS "store_partner_bean_logs_partner_store_idx";

-- AlterTable
ALTER TABLE "employee_payrolls" ALTER COLUMN "month" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "members" ALTER COLUMN "bean_balance" SET NOT NULL;

-- AlterTable
ALTER TABLE "store_invite_codes" ALTER COLUMN "code" SET DATA TYPE TEXT,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "store_wechat_pay_configs" ALTER COLUMN "mch_id" SET DATA TYPE TEXT,
ALTER COLUMN "mch_name" SET DATA TYPE TEXT,
ALTER COLUMN "configured_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "store_membership_promo_records" ADD CONSTRAINT "store_membership_promo_records_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "store_partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_invite_codes" ADD CONSTRAINT "store_invite_codes_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_wechat_pay_configs" ADD CONSTRAINT "store_wechat_pay_configs_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
