ALTER TABLE "service_calls"
  ADD COLUMN "last_requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "reminder_count" INTEGER NOT NULL DEFAULT 1;

UPDATE "service_calls"
SET "last_requested_at" = "requested_at"
WHERE "last_requested_at" = "created_at";

CREATE INDEX "service_calls_store_status_last_requested_at_idx"
  ON "service_calls"("store_id", "status", "last_requested_at");
