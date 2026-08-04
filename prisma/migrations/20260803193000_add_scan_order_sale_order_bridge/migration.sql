ALTER TYPE "SalesPaymentMethod" ADD VALUE IF NOT EXISTS 'other';

ALTER TABLE "sale_orders"
  ADD COLUMN "scan_order_id" INTEGER;

CREATE UNIQUE INDEX "sale_orders_scan_order_id_key"
  ON "sale_orders"("scan_order_id");

ALTER TABLE "sale_orders"
  ADD CONSTRAINT "sale_orders_scan_order_id_fkey"
  FOREIGN KEY ("scan_order_id") REFERENCES "scan_orders"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "sale_order_refunds" (
  "id" SERIAL NOT NULL,
  "sale_order_id" INTEGER NOT NULL,
  "store_id" INTEGER NOT NULL,
  "amount" INTEGER NOT NULL,
  "profit" INTEGER NOT NULL,
  "payment_method" "SalesPaymentMethod" NOT NULL,
  "refunded_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sale_order_refunds_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sale_order_refunds_sale_order_id_key"
  ON "sale_order_refunds"("sale_order_id");
CREATE INDEX "sale_order_refunds_store_id_refunded_at_idx"
  ON "sale_order_refunds"("store_id", "refunded_at" DESC);

ALTER TABLE "sale_order_refunds"
  ADD CONSTRAINT "sale_order_refunds_sale_order_id_fkey"
  FOREIGN KEY ("sale_order_id") REFERENCES "sale_orders"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "sale_order_refunds_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "finance_cash_flow_records"
  ADD COLUMN "sale_order_refund_id" INTEGER;

CREATE UNIQUE INDEX "finance_cash_flow_records_sale_order_refund_id_key"
  ON "finance_cash_flow_records"("sale_order_refund_id");

ALTER TABLE "finance_cash_flow_records"
  ADD CONSTRAINT "finance_cash_flow_records_sale_order_refund_id_fkey"
  FOREIGN KEY ("sale_order_refund_id") REFERENCES "sale_order_refunds"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
