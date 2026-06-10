DROP INDEX IF EXISTS "finance_account_records_store_id_status_updated_at_idx";
CREATE INDEX "finance_account_records_store_id_status_updated_at_id_idx"
ON "finance_account_records" (
  "store_id",
  "status",
  "updated_at" DESC,
  "id" DESC
);

DROP INDEX IF EXISTS "cost_records_store_id_date_idx";
CREATE INDEX "cost_records_store_id_date_created_at_id_idx"
ON "cost_records" (
  "store_id",
  "date" DESC,
  "created_at" DESC,
  "id" DESC
);

DROP INDEX IF EXISTS "cost_records_store_id_type_date_idx";
CREATE INDEX "cost_records_store_id_type_date_created_at_id_idx"
ON "cost_records" (
  "store_id",
  "type",
  "date" DESC,
  "created_at" DESC,
  "id" DESC
);
