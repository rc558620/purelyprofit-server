ALTER TYPE "ServiceCallStatus" ADD VALUE IF NOT EXISTS 'expired';

ALTER TABLE "service_calls"
  ADD COLUMN "expires_at" TIMESTAMP(3),
  ADD COLUMN "expired_at" TIMESTAMP(3);

UPDATE "service_calls"
SET "expires_at" = COALESCE(
  "processing_started_at" + INTERVAL '15 minutes',
  "last_requested_at" + INTERVAL '5 minutes',
  "requested_at" + INTERVAL '5 minutes'
)
WHERE "expires_at" IS NULL;

ALTER TABLE "service_calls"
  ALTER COLUMN "expires_at" SET NOT NULL;

CREATE INDEX "service_calls_status_expires_at_idx"
  ON "service_calls"("status", "expires_at");
