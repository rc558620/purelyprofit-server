-- AlterTable: actualIncome / actualExpense 改为可空，区分「未录入」与「录入为 0」
ALTER TABLE "finance_reconciliation_records" ALTER COLUMN "actual_income" DROP NOT NULL;
ALTER TABLE "finance_reconciliation_records" ALTER COLUMN "actual_expense" DROP NOT NULL;

-- 将已有 draft 记录的 0 还原为 NULL（draft 语义 = 未录入）
UPDATE "finance_reconciliation_records"
SET "actual_income" = NULL,
    "actual_expense" = NULL
WHERE "status" = 'draft';
