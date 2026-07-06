-- AlterTable: Add settlement/link fields to FinanceReconciliationRecord
ALTER TABLE "finance_reconciliation_records"
  ADD COLUMN "settlement_batch_no" TEXT,
  ADD COLUMN "linked_order_nos" TEXT,
  ADD COLUMN "linked_order_count" INTEGER,
  ADD COLUMN "linked_receivable_amount" INTEGER,
  ADD COLUMN "linked_settled_amount" INTEGER,
  ADD COLUMN "linked_fee_amount" INTEGER;
