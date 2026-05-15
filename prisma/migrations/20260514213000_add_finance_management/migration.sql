-- CreateEnum
CREATE TYPE "FinanceCashFlowDirection" AS ENUM (
  'income',
  'expense'
);

-- CreateEnum
CREATE TYPE "FinanceCashFlowCategory" AS ENUM (
  'sales',
  'refund',
  'transfer_in',
  'other_income',
  'purchase',
  'rent',
  'salary',
  'marketing',
  'tax',
  'transfer_out',
  'other_expense'
);

-- CreateEnum
CREATE TYPE "FinanceCashFlowPayment" AS ENUM (
  'cash',
  'wechat',
  'alipay',
  'card',
  'bank',
  'other'
);

-- CreateEnum
CREATE TYPE "FinanceAccountType" AS ENUM (
  'receivable',
  'payable'
);

-- CreateEnum
CREATE TYPE "FinanceAccountStatus" AS ENUM (
  'pending',
  'partial',
  'settled',
  'overdue'
);

-- CreateEnum
CREATE TYPE "FinanceAccountCategory" AS ENUM (
  'sales_credit',
  'advance_paid',
  'supplier_debt',
  'loan',
  'deposit',
  'other'
);

-- CreateEnum
CREATE TYPE "FinanceReconciliationStatus" AS ENUM (
  'draft',
  'confirmed',
  'discrepancy',
  'adjusted'
);

-- CreateEnum
CREATE TYPE "FinanceReconciliationType" AS ENUM (
  'daily',
  'weekly',
  'monthly',
  'payment',
  'supplier',
  'custom'
);

-- CreateEnum
CREATE TYPE "FinancePaymentChannel" AS ENUM (
  'cash',
  'wechat',
  'alipay',
  'card',
  'bank',
  'all'
);

-- CreateTable
CREATE TABLE "finance_cash_flow_records" (
  "id" SERIAL NOT NULL,
  "store_id" INTEGER NOT NULL,
  "operator_staff_id" INTEGER,
  "direction" "FinanceCashFlowDirection" NOT NULL,
  "category" "FinanceCashFlowCategory" NOT NULL,
  "title" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "payment" "FinanceCashFlowPayment" NOT NULL,
  "note" TEXT,
  "date" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "finance_cash_flow_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_account_records" (
  "id" SERIAL NOT NULL,
  "store_id" INTEGER NOT NULL,
  "operator_staff_id" INTEGER,
  "type" "FinanceAccountType" NOT NULL,
  "category" "FinanceAccountCategory" NOT NULL,
  "counterpart" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "paid_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "remaining" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "status" "FinanceAccountStatus" NOT NULL DEFAULT 'pending',
  "due_date" TIMESTAMP(3),
  "date" TIMESTAMP(3) NOT NULL,
  "note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "finance_account_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_reconciliation_records" (
  "id" SERIAL NOT NULL,
  "store_id" INTEGER NOT NULL,
  "operator_staff_id" INTEGER,
  "title" TEXT NOT NULL,
  "type" "FinanceReconciliationType" NOT NULL,
  "status" "FinanceReconciliationStatus" NOT NULL DEFAULT 'draft',
  "channel" "FinancePaymentChannel",
  "counterpart" TEXT,
  "period_start" TIMESTAMP(3) NOT NULL,
  "period_end" TIMESTAMP(3) NOT NULL,
  "book_income" DECIMAL(12,2) NOT NULL,
  "book_expense" DECIMAL(12,2) NOT NULL,
  "book_net" DECIMAL(12,2) NOT NULL,
  "actual_income" DECIMAL(12,2) NOT NULL,
  "actual_expense" DECIMAL(12,2) NOT NULL,
  "actual_net" DECIMAL(12,2) NOT NULL,
  "diff_amount" DECIMAL(12,2) NOT NULL,
  "adjust_note" TEXT,
  "operator" TEXT,
  "note" TEXT,
  "date" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "finance_reconciliation_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_reconciliation_items" (
  "id" SERIAL NOT NULL,
  "reconciliation_id" INTEGER NOT NULL,
  "description" TEXT NOT NULL,
  "book_amount" DECIMAL(12,2) NOT NULL,
  "actual_amount" DECIMAL(12,2) NOT NULL,
  "difference" DECIMAL(12,2) NOT NULL,
  "note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "finance_reconciliation_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "finance_cash_flow_records_store_id_date_idx"
  ON "finance_cash_flow_records"("store_id", "date");

-- CreateIndex
CREATE INDEX "finance_cash_flow_records_store_id_direction_date_idx"
  ON "finance_cash_flow_records"("store_id", "direction", "date");

-- CreateIndex
CREATE INDEX "finance_cash_flow_records_store_id_category_date_idx"
  ON "finance_cash_flow_records"("store_id", "category", "date");

-- CreateIndex
CREATE INDEX "finance_cash_flow_records_operator_staff_id_created_at_idx"
  ON "finance_cash_flow_records"("operator_staff_id", "created_at");

-- CreateIndex
CREATE INDEX "finance_account_records_store_id_status_updated_at_idx"
  ON "finance_account_records"("store_id", "status", "updated_at");

-- CreateIndex
CREATE INDEX "finance_account_records_store_id_type_updated_at_idx"
  ON "finance_account_records"("store_id", "type", "updated_at");

-- CreateIndex
CREATE INDEX "finance_account_records_store_id_due_date_idx"
  ON "finance_account_records"("store_id", "due_date");

-- CreateIndex
CREATE INDEX "finance_account_records_operator_staff_id_created_at_idx"
  ON "finance_account_records"("operator_staff_id", "created_at");

-- CreateIndex
CREATE INDEX "finance_reconciliation_records_store_id_status_date_idx"
  ON "finance_reconciliation_records"("store_id", "status", "date");

-- CreateIndex
CREATE INDEX "finance_reconciliation_records_store_id_type_date_idx"
  ON "finance_reconciliation_records"("store_id", "type", "date");

-- CreateIndex
CREATE INDEX "finance_reconciliation_records_operator_staff_id_created_at_idx"
  ON "finance_reconciliation_records"("operator_staff_id", "created_at");

-- CreateIndex
CREATE INDEX "finance_reconciliation_items_reconciliation_id_created_at_idx"
  ON "finance_reconciliation_items"("reconciliation_id", "created_at");

-- AddForeignKey
ALTER TABLE "finance_cash_flow_records"
  ADD CONSTRAINT "finance_cash_flow_records_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_cash_flow_records"
  ADD CONSTRAINT "finance_cash_flow_records_operator_staff_id_fkey"
  FOREIGN KEY ("operator_staff_id") REFERENCES "staffs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_account_records"
  ADD CONSTRAINT "finance_account_records_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_account_records"
  ADD CONSTRAINT "finance_account_records_operator_staff_id_fkey"
  FOREIGN KEY ("operator_staff_id") REFERENCES "staffs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_reconciliation_records"
  ADD CONSTRAINT "finance_reconciliation_records_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_reconciliation_records"
  ADD CONSTRAINT "finance_reconciliation_records_operator_staff_id_fkey"
  FOREIGN KEY ("operator_staff_id") REFERENCES "staffs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_reconciliation_items"
  ADD CONSTRAINT "finance_reconciliation_items_reconciliation_id_fkey"
  FOREIGN KEY ("reconciliation_id") REFERENCES "finance_reconciliation_records"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
