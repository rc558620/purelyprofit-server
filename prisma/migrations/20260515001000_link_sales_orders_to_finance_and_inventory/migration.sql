ALTER TYPE "InventoryAdjustType" ADD VALUE IF NOT EXISTS 'sale';

ALTER TABLE "finance_cash_flow_records"
ADD COLUMN "sale_order_id" INTEGER;

ALTER TABLE "inventory_adjustment_logs"
ADD COLUMN "sale_order_id" INTEGER;

CREATE UNIQUE INDEX "finance_cash_flow_records_sale_order_id_key"
ON "finance_cash_flow_records"("sale_order_id");

CREATE INDEX "inventory_adjustment_logs_sale_order_id_created_at_idx"
ON "inventory_adjustment_logs"("sale_order_id", "created_at");

ALTER TABLE "finance_cash_flow_records"
ADD CONSTRAINT "finance_cash_flow_records_sale_order_id_fkey"
FOREIGN KEY ("sale_order_id") REFERENCES "sale_orders"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "inventory_adjustment_logs"
ADD CONSTRAINT "inventory_adjustment_logs_sale_order_id_fkey"
FOREIGN KEY ("sale_order_id") REFERENCES "sale_orders"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
