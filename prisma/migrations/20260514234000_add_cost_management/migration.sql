-- CreateEnum
CREATE TYPE "CostType" AS ENUM ('fixed', 'variable');

-- CreateEnum
CREATE TYPE "CostCategory" AS ENUM (
  'rent',
  'salary',
  'insurance',
  'provident_fund',
  'utilities',
  'purchase',
  'equipment',
  'marketing',
  'packaging',
  'other'
);

-- CreateEnum
CREATE TYPE "CostSourceType" AS ENUM (
  'manual',
  'purchase',
  'payroll_salary',
  'payroll_insurance',
  'payroll_provident_fund'
);

-- CreateTable
CREATE TABLE "cost_records" (
  "id" SERIAL NOT NULL,
  "store_id" INTEGER NOT NULL,
  "operator_staff_id" INTEGER,
  "purchase_order_id" INTEGER,
  "payroll_id" INTEGER,
  "source_type" "CostSourceType" NOT NULL,
  "title" TEXT NOT NULL,
  "type" "CostType" NOT NULL,
  "category" "CostCategory" NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "note" TEXT,
  "date" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "cost_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cost_records_store_id_source_type_purchase_order_id_key"
  ON "cost_records"("store_id", "source_type", "purchase_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "cost_records_store_id_source_type_payroll_id_key"
  ON "cost_records"("store_id", "source_type", "payroll_id");

-- CreateIndex
CREATE INDEX "cost_records_store_id_date_idx"
  ON "cost_records"("store_id", "date");

-- CreateIndex
CREATE INDEX "cost_records_store_id_type_date_idx"
  ON "cost_records"("store_id", "type", "date");

-- CreateIndex
CREATE INDEX "cost_records_store_id_category_date_idx"
  ON "cost_records"("store_id", "category", "date");

-- CreateIndex
CREATE INDEX "cost_records_operator_staff_id_created_at_idx"
  ON "cost_records"("operator_staff_id", "created_at");

-- AddForeignKey
ALTER TABLE "cost_records"
  ADD CONSTRAINT "cost_records_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_records"
  ADD CONSTRAINT "cost_records_operator_staff_id_fkey"
  FOREIGN KEY ("operator_staff_id") REFERENCES "staffs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_records"
  ADD CONSTRAINT "cost_records_purchase_order_id_fkey"
  FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_records"
  ADD CONSTRAINT "cost_records_payroll_id_fkey"
  FOREIGN KEY ("payroll_id") REFERENCES "employee_payrolls"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
