-- CreateEnum
CREATE TYPE "MarketingPointsChangeType" AS ENUM ('earn', 'spend', 'expire', 'gift');

-- CreateTable
CREATE TABLE "marketing_points_records" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "type" "MarketingPointsChangeType" NOT NULL,
    "description" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketing_points_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "marketing_points_records_store_id_created_at_idx" ON "marketing_points_records"("store_id", "created_at");

-- CreateIndex
CREATE INDEX "marketing_points_records_customer_id_created_at_idx" ON "marketing_points_records"("customer_id", "created_at");

-- CreateIndex
CREATE INDEX "marketing_points_records_store_id_type_created_at_idx" ON "marketing_points_records"("store_id", "type", "created_at");

-- AddForeignKey
ALTER TABLE "marketing_points_records" ADD CONSTRAINT "marketing_points_records_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_points_records" ADD CONSTRAINT "marketing_points_records_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "marketing_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill existing points spend logs from historical consumptions
INSERT INTO "marketing_points_records" (
    "store_id",
    "customer_id",
    "amount",
    "type",
    "description",
    "created_at"
)
SELECT
    c."store_id",
    c."customer_id",
    -c."points_deducted",
    'spend'::"MarketingPointsChangeType",
    CASE
        WHEN c."items_summary" IS NOT NULL AND BTRIM(c."items_summary") <> ''
            THEN '消费抵扣：' || c."items_summary"
        ELSE '消费抵扣积分'
    END,
    c."created_at"
FROM "marketing_consumptions" c
WHERE c."points_deducted" > 0;
