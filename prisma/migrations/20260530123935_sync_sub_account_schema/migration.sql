-- CreateEnum
CREATE TYPE "StoreSubAccountRole" AS ENUM ('cashier', 'finance');

-- CreateEnum
CREATE TYPE "StoreSubAccountStatus" AS ENUM ('active', 'inactive', 'disabled');

-- CreateEnum
CREATE TYPE "HandoverMode" AS ENUM ('self_main_account', 'sub_account');

-- CreateEnum
CREATE TYPE "HandoverStatus" AS ENUM ('pending', 'completed', 'cancelled');

-- AlterTable
ALTER TABLE "store_membership_profiles" ADD COLUMN     "sub_account_quota" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "store_sub_account_quota_audits" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "old_quota" INTEGER NOT NULL,
    "new_quota" INTEGER NOT NULL,
    "operator_user_id" INTEGER,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_sub_account_quota_audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_sub_accounts" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "employee_id" INTEGER,
    "slot_index" INTEGER NOT NULL,
    "role" "StoreSubAccountRole" NOT NULL,
    "status" "StoreSubAccountStatus" NOT NULL DEFAULT 'active',
    "is_assigned" BOOLEAN NOT NULL DEFAULT false,
    "can_use_handover" BOOLEAN NOT NULL DEFAULT true,
    "can_access_home" BOOLEAN NOT NULL DEFAULT true,
    "assigned_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_sub_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_handover_records" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "from_employee_id" INTEGER,
    "to_employee_id" INTEGER,
    "from_sub_account_id" INTEGER,
    "to_sub_account_id" INTEGER,
    "actor_staff_id" INTEGER,
    "handover_mode" "HandoverMode" NOT NULL,
    "status" "HandoverStatus" NOT NULL DEFAULT 'pending',
    "handover_at" TIMESTAMP(3),
    "note" TEXT,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_handover_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "store_sub_account_quota_audits_store_id_created_at_idx" ON "store_sub_account_quota_audits"("store_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "store_sub_accounts_employee_id_key" ON "store_sub_accounts"("employee_id");

-- CreateIndex
CREATE INDEX "store_sub_accounts_store_id_role_status_idx" ON "store_sub_accounts"("store_id", "role", "status");

-- CreateIndex
CREATE INDEX "store_sub_accounts_store_id_is_assigned_status_idx" ON "store_sub_accounts"("store_id", "is_assigned", "status");

-- CreateIndex
CREATE UNIQUE INDEX "store_sub_accounts_store_id_slot_index_key" ON "store_sub_accounts"("store_id", "slot_index");

-- CreateIndex
CREATE INDEX "store_handover_records_store_id_status_created_at_idx" ON "store_handover_records"("store_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "store_handover_records_from_employee_id_created_at_idx" ON "store_handover_records"("from_employee_id", "created_at");

-- CreateIndex
CREATE INDEX "store_handover_records_to_employee_id_created_at_idx" ON "store_handover_records"("to_employee_id", "created_at");

-- AddForeignKey
ALTER TABLE "store_sub_account_quota_audits" ADD CONSTRAINT "store_sub_account_quota_audits_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_sub_accounts" ADD CONSTRAINT "store_sub_accounts_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_sub_accounts" ADD CONSTRAINT "store_sub_accounts_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_handover_records" ADD CONSTRAINT "store_handover_records_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_handover_records" ADD CONSTRAINT "store_handover_records_from_employee_id_fkey" FOREIGN KEY ("from_employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_handover_records" ADD CONSTRAINT "store_handover_records_to_employee_id_fkey" FOREIGN KEY ("to_employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_handover_records" ADD CONSTRAINT "store_handover_records_from_sub_account_id_fkey" FOREIGN KEY ("from_sub_account_id") REFERENCES "store_sub_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_handover_records" ADD CONSTRAINT "store_handover_records_to_sub_account_id_fkey" FOREIGN KEY ("to_sub_account_id") REFERENCES "store_sub_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_handover_records" ADD CONSTRAINT "store_handover_records_actor_staff_id_fkey" FOREIGN KEY ("actor_staff_id") REFERENCES "staffs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "store_membership_promo_records_store_id_has_charged_registered_" RENAME TO "store_membership_promo_records_store_id_has_charged_registe_idx";
