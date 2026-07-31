CREATE TYPE "ScanOrderBalanceTransactionType" AS ENUM ('payment', 'refund');

CREATE TABLE "scan_order_balance_transactions" (
  "id" SERIAL PRIMARY KEY,
  "order_id" INTEGER NOT NULL REFERENCES "scan_orders"("id") ON DELETE CASCADE,
  "customer_id" INTEGER NOT NULL,
  "amount" INTEGER NOT NULL,
  "type" "ScanOrderBalanceTransactionType" NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "uq_scan_order_balance_transactions_order_type" UNIQUE ("order_id", "type")
);

CREATE INDEX "idx_scan_order_balance_transactions_customer_created"
  ON "scan_order_balance_transactions" ("customer_id", "created_at" DESC);
