-- CreateEnum
CREATE TYPE "PartnerAccountStatus" AS ENUM (
  'pending',
  'reviewing',
  'approved',
  'rejected'
);

-- CreateEnum
CREATE TYPE "WithdrawalAccountType" AS ENUM (
  'wechat',
  'alipay',
  'bank'
);

-- CreateEnum
CREATE TYPE "PartnerWithdrawalStatus" AS ENUM (
  'pending',
  'approved',
  'paid',
  'rejected'
);

-- CreateTable
CREATE TABLE "store_partners" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "status" "PartnerAccountStatus" NOT NULL DEFAULT 'pending',
    "name" TEXT,
    "phone" TEXT,
    "id_card" TEXT,
    "payment_account_type" "WithdrawalAccountType",
    "payment_account_no" TEXT,
    "payment_account_name" TEXT,
    "bean_balance" INTEGER NOT NULL DEFAULT 0,
    "total_earned_beans" INTEGER NOT NULL DEFAULT 0,
    "total_withdrawn_beans" INTEGER NOT NULL DEFAULT 0,
    "joined_at" TIMESTAMP(3),
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_partners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_withdrawals" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "partner_id" INTEGER NOT NULL,
    "operator_staff_id" INTEGER,
    "bean_amount" INTEGER NOT NULL,
    "rmb_amount" INTEGER NOT NULL,
    "account_type" "WithdrawalAccountType" NOT NULL,
    "account_no" TEXT NOT NULL,
    "account_name" TEXT NOT NULL,
    "status" "PartnerWithdrawalStatus" NOT NULL DEFAULT 'pending',
    "reject_reason" TEXT,
    "applied_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partner_withdrawals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "store_partners_store_id_key" ON "store_partners"("store_id");

-- CreateIndex
CREATE INDEX "store_partners_status_updated_at_idx"
  ON "store_partners"("status", "updated_at");

-- CreateIndex
CREATE INDEX "partner_withdrawals_store_id_applied_at_idx"
  ON "partner_withdrawals"("store_id", "applied_at");

-- CreateIndex
CREATE INDEX "partner_withdrawals_partner_id_applied_at_idx"
  ON "partner_withdrawals"("partner_id", "applied_at");

-- CreateIndex
CREATE INDEX "partner_withdrawals_status_applied_at_idx"
  ON "partner_withdrawals"("status", "applied_at");

-- CreateIndex
CREATE INDEX "partner_withdrawals_operator_staff_id_applied_at_idx"
  ON "partner_withdrawals"("operator_staff_id", "applied_at");

-- AddForeignKey
ALTER TABLE "store_partners"
  ADD CONSTRAINT "store_partners_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_withdrawals"
  ADD CONSTRAINT "partner_withdrawals_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_withdrawals"
  ADD CONSTRAINT "partner_withdrawals_partner_id_fkey"
  FOREIGN KEY ("partner_id") REFERENCES "store_partners"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_withdrawals"
  ADD CONSTRAINT "partner_withdrawals_operator_staff_id_fkey"
  FOREIGN KEY ("operator_staff_id") REFERENCES "staffs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
