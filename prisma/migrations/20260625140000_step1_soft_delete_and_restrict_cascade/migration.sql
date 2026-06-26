-- Step 1: 软删除字段、Partial Unique Index 与危险级联修复
--
-- 变更内容：
-- 1. 为软删除主档表新增 deleted_at 字段（MarketingCustomer/Product/ProductCategory/Space/Employee/StorePartner）
-- 2. 为 MarketingCustomer 新增 external_identifier 字段和 status 枚举字段
-- 3. 将普通 Unique Index 改为 Partial Unique Index（WHERE deleted_at IS NULL），
--    允许软删除后使用相同手机号/编码/工号重新建档
-- 4. 将流水表（MemberPointsLog/BeanLog/RechargeLog/MarketingRecharge 等）的
--    onDelete: Cascade 改为 onDelete: Restrict，防止软删主档时级联误删历史数据
-- 5. 将 SpaceReservation/SpaceSession 的 onDelete: Cascade 改为 Restrict
-- 6. 修复 staffs 表唯一索引漂移（单纯 email unique → store_id+email unique）

-- CreateEnum
CREATE TYPE "MarketingCustomerStatus" AS ENUM ('active', 'inactive', 'banned');

-- DropForeignKey（将改为 Restrict 的外键，先删后建）
ALTER TABLE "employee_leaves" DROP CONSTRAINT "employee_leaves_employee_id_fkey";
ALTER TABLE "employee_payrolls" DROP CONSTRAINT "employee_payrolls_employee_id_fkey";
ALTER TABLE "employee_shifts" DROP CONSTRAINT "employee_shifts_employee_id_fkey";

ALTER TABLE "marketing_consumptions" DROP CONSTRAINT "marketing_consumptions_customer_id_fkey";
ALTER TABLE "marketing_points_records" DROP CONSTRAINT "marketing_points_records_customer_id_fkey";
ALTER TABLE "marketing_recharges" DROP CONSTRAINT "marketing_recharges_customer_id_fkey";

ALTER TABLE "member_bean_logs" DROP CONSTRAINT "member_bean_logs_member_id_fkey";
ALTER TABLE "member_points_logs" DROP CONSTRAINT "member_points_logs_member_id_fkey";
ALTER TABLE "member_recharge_logs" DROP CONSTRAINT "member_recharge_logs_member_id_fkey";

ALTER TABLE "partner_withdrawals" DROP CONSTRAINT "partner_withdrawals_partner_id_fkey";
ALTER TABLE "store_partner_bean_logs" DROP CONSTRAINT "store_partner_bean_logs_partner_id_fkey";

ALTER TABLE "space_reservations" DROP CONSTRAINT "space_reservations_space_id_fkey";
ALTER TABLE "space_sessions" DROP CONSTRAINT "space_sessions_space_id_fkey";

-- DropIndex（普通唯一索引，将被替换为 Partial Unique Index）
DROP INDEX "employees_store_id_emp_no_key";
DROP INDEX "marketing_customers_store_id_phone_key";
DROP INDEX "members_store_id_phone_key";
DROP INDEX "product_categories_store_id_name_key";
DROP INDEX "products_store_id_code_key";
DROP INDEX "spaces_store_id_name_key";
-- 修复 staffs 表的 email 唯一约束漂移
DROP INDEX IF EXISTS "staffs_email_key";

-- AlterTable: 新增 deleted_at 字段
ALTER TABLE "employees" ADD COLUMN "deleted_at" TIMESTAMP(3);
ALTER TABLE "marketing_customers"
  ADD COLUMN "deleted_at" TIMESTAMP(3),
  ADD COLUMN "external_identifier" TEXT,
  ADD COLUMN "status" "MarketingCustomerStatus" NOT NULL DEFAULT 'active';
ALTER TABLE "product_categories" ADD COLUMN "deleted_at" TIMESTAMP(3);
ALTER TABLE "products" ADD COLUMN "deleted_at" TIMESTAMP(3);
ALTER TABLE "spaces" ADD COLUMN "deleted_at" TIMESTAMP(3);
ALTER TABLE "store_partners" ADD COLUMN "deleted_at" TIMESTAMP(3);
-- 修正 stores.deleted_at 类型（之前旧迁移添加的是 TIMESTAMP，现在统一为 TIMESTAMP(3)）
ALTER TABLE "stores" ALTER COLUMN "deleted_at" SET DATA TYPE TIMESTAMP(3);
-- 修正 members.deleted_at 类型
ALTER TABLE "members" ALTER COLUMN "deleted_at" SET DATA TYPE TIMESTAMP(3);

-- CreateIndex: 普通索引（替代原唯一索引）
CREATE INDEX "employees_store_id_emp_no_idx" ON "employees"("store_id", "emp_no");
CREATE INDEX "marketing_customers_store_id_phone_idx" ON "marketing_customers"("store_id", "phone");
CREATE INDEX "marketing_customers_store_id_external_identifier_idx" ON "marketing_customers"("store_id", "external_identifier");
CREATE INDEX "members_store_id_phone_idx" ON "members"("store_id", "phone");
CREATE INDEX "product_categories_store_id_name_idx" ON "product_categories"("store_id", "name");
CREATE INDEX "products_store_id_code_idx" ON "products"("store_id", "code");
CREATE INDEX "spaces_store_id_name_idx" ON "spaces"("store_id", "name");
CREATE INDEX "spaces_store_id_sort_order_idx" ON "spaces"("store_id", "sort_order");

-- CreateIndex: Partial Unique Index（软删除兼容唯一约束）
-- 仅对未删除（deleted_at IS NULL）的行强制唯一，允许软删后重新使用相同的标识符

-- 会员手机号（storeId + phone）：同一门店下，未删除会员的手机号唯一
CREATE UNIQUE INDEX "members_store_id_phone_partial_key"
  ON "members"("store_id", "phone")
  WHERE "deleted_at" IS NULL AND "phone" IS NOT NULL;

-- 顾客手机号（storeId + phone）：同一门店下，未删除顾客的手机号唯一
CREATE UNIQUE INDEX "marketing_customers_store_id_phone_partial_key"
  ON "marketing_customers"("store_id", "phone")
  WHERE "deleted_at" IS NULL AND "phone" IS NOT NULL;

-- 顾客外部标识（storeId + externalIdentifier）：同一门店下，未删除顾客的外部标识唯一
CREATE UNIQUE INDEX "marketing_customers_store_id_external_partial_key"
  ON "marketing_customers"("store_id", "external_identifier")
  WHERE "deleted_at" IS NULL AND "external_identifier" IS NOT NULL;

-- 商品编码（storeId + code）：同一门店下，未删除商品的编码唯一
CREATE UNIQUE INDEX "products_store_id_code_partial_key"
  ON "products"("store_id", "code")
  WHERE "deleted_at" IS NULL;

-- 商品分类名称（storeId + name）：同一门店下，未删除分类的名称唯一
CREATE UNIQUE INDEX "product_categories_store_id_name_partial_key"
  ON "product_categories"("store_id", "name")
  WHERE "deleted_at" IS NULL;

-- 空间名称（storeId + name）：同一门店下，未删除空间的名称唯一
CREATE UNIQUE INDEX "spaces_store_id_name_partial_key"
  ON "spaces"("store_id", "name")
  WHERE "deleted_at" IS NULL;

-- 员工工号（storeId + empNo）：同一门店下，未删除员工的工号唯一
CREATE UNIQUE INDEX "employees_store_id_emp_no_partial_key"
  ON "employees"("store_id", "emp_no")
  WHERE "deleted_at" IS NULL;

-- 修复 staffs 表唯一约束（store_id + email 复合唯一）
CREATE UNIQUE INDEX "staffs_store_id_email_key" ON "staffs"("store_id", "email");

-- AddForeignKey: 重建 Restrict 外键（流水/审计表禁止级联删除）
ALTER TABLE "marketing_recharges"
  ADD CONSTRAINT "marketing_recharges_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "marketing_customers"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "marketing_consumptions"
  ADD CONSTRAINT "marketing_consumptions_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "marketing_customers"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "marketing_points_records"
  ADD CONSTRAINT "marketing_points_records_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "marketing_customers"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "member_points_logs"
  ADD CONSTRAINT "member_points_logs_member_id_fkey"
  FOREIGN KEY ("member_id") REFERENCES "members"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "member_bean_logs"
  ADD CONSTRAINT "member_bean_logs_member_id_fkey"
  FOREIGN KEY ("member_id") REFERENCES "members"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "member_recharge_logs"
  ADD CONSTRAINT "member_recharge_logs_member_id_fkey"
  FOREIGN KEY ("member_id") REFERENCES "members"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "store_partner_bean_logs"
  ADD CONSTRAINT "store_partner_bean_logs_partner_id_fkey"
  FOREIGN KEY ("partner_id") REFERENCES "store_partners"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "partner_withdrawals"
  ADD CONSTRAINT "partner_withdrawals_partner_id_fkey"
  FOREIGN KEY ("partner_id") REFERENCES "store_partners"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "space_reservations"
  ADD CONSTRAINT "space_reservations_space_id_fkey"
  FOREIGN KEY ("space_id") REFERENCES "spaces"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "space_sessions"
  ADD CONSTRAINT "space_sessions_space_id_fkey"
  FOREIGN KEY ("space_id") REFERENCES "spaces"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "employee_leaves"
  ADD CONSTRAINT "employee_leaves_employee_id_fkey"
  FOREIGN KEY ("employee_id") REFERENCES "employees"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "employee_shifts"
  ADD CONSTRAINT "employee_shifts_employee_id_fkey"
  FOREIGN KEY ("employee_id") REFERENCES "employees"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "employee_payrolls"
  ADD CONSTRAINT "employee_payrolls_employee_id_fkey"
  FOREIGN KEY ("employee_id") REFERENCES "employees"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
