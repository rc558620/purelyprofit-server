CREATE TYPE "ScanOrderingArchiveReason" AS ENUM ('cleared', 'auto_timeout');

ALTER TABLE "scan_ordering_sessions"
  ADD COLUMN "ended_at" TIMESTAMP(3),
  ADD COLUMN "archive_reason" "ScanOrderingArchiveReason";

CREATE INDEX "idx_scan_ordering_sessions_history"
  ON "scan_ordering_sessions" ("club_user_id", "status", "ended_at" DESC)
  WHERE "deleted_at" IS NULL;
