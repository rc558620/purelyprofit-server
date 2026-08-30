-- CreateEnum
CREATE TYPE "CommissionRecordStatus" AS ENUM ('pending', 'settled', 'included', 'cancelled');

-- CreateTable
CREATE TABLE "commission_services" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "default_commission" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 1,
    "overrides" JSONB,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commission_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_records" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "session_id" INTEGER NOT NULL,
    "space_name" TEXT NOT NULL,
    "technician_id" INTEGER NOT NULL,
    "technician_name" TEXT NOT NULL,
    "service_ids" JSONB NOT NULL,
    "service_names" JSONB NOT NULL,
    "commission" INTEGER NOT NULL,
    "status" "CommissionRecordStatus" NOT NULL DEFAULT 'settled',
    "settled_at" TIMESTAMP(3) NOT NULL,
    "month" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commission_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "commission_services_store_id_enabled_sort_order_idx" ON "commission_services"("store_id", "enabled", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "commission_services_store_id_name_key_active" ON "commission_services"("store_id", "name") WHERE (deleted_at IS NULL);

-- CreateIndex
CREATE INDEX "commission_records_store_id_month_idx" ON "commission_records"("store_id", "month");

-- CreateIndex
CREATE INDEX "commission_records_store_id_technician_id_month_idx" ON "commission_records"("store_id", "technician_id", "month");

-- CreateIndex
CREATE INDEX "commission_records_store_id_status_idx" ON "commission_records"("store_id", "status");

-- CreateIndex
CREATE INDEX "commission_records_settled_at_idx" ON "commission_records"("settled_at");

-- CreateIndex
CREATE INDEX "commission_records_session_id_idx" ON "commission_records"("session_id");

-- AlterTable
ALTER TABLE "space_sessions" ADD COLUMN "commission_assignments" JSONB;

-- AlterTable
ALTER TABLE "employee_payrolls" ADD COLUMN "commission" INTEGER NOT NULL DEFAULT 0;

-- AddForeignKey
ALTER TABLE "commission_services" ADD CONSTRAINT "commission_services_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_records" ADD CONSTRAINT "commission_records_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_records" ADD CONSTRAINT "commission_records_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "space_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
