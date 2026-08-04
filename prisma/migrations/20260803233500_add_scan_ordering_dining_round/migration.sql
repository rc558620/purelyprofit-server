ALTER TABLE "scan_ordering_sessions"
  ADD COLUMN "dining_round_id" UUID;

-- Existing sessions retain a stable independent round. Future application writes
-- merge active/left sessions only while the table remains uncleared.
UPDATE "scan_ordering_sessions"
SET "dining_round_id" = gen_random_uuid()
WHERE "dining_round_id" IS NULL;

-- A live table can contain a left session from a rescan and the active session
-- that replaced it. They are one dining round until checkout.
UPDATE "scan_ordering_sessions" AS "left_session"
SET "dining_round_id" = "active_session"."dining_round_id"
FROM "scan_ordering_sessions" AS "active_session"
WHERE "left_session"."status" = 'left'::"ScanOrderingSessionStatus"
  AND "active_session"."status" = 'active'::"ScanOrderingSessionStatus"
  AND "active_session"."deleted_at" IS NULL
  AND "left_session"."store_id" = "active_session"."store_id"
  AND "left_session"."table_id" = "active_session"."table_id"
  AND "left_session"."club_user_id" = "active_session"."club_user_id";

ALTER TABLE "scan_ordering_sessions"
  ALTER COLUMN "dining_round_id" SET NOT NULL;

ALTER TABLE "scan_orders"
  ADD COLUMN "dining_round_id" UUID;

UPDATE "scan_orders" AS "order"
SET "dining_round_id" = "session"."dining_round_id"
FROM "scan_ordering_sessions" AS "session"
WHERE "order"."session_id" = "session"."id"
  AND "order"."dining_round_id" IS NULL;

-- Orders without a session are legacy rows; keep each isolated rather than
-- accidentally combining unrelated historical orders.
UPDATE "scan_orders"
SET "dining_round_id" = gen_random_uuid()
WHERE "dining_round_id" IS NULL;

ALTER TABLE "scan_orders"
  ALTER COLUMN "dining_round_id" SET NOT NULL;

CREATE INDEX "scan_ordering_sessions_store_table_user_round_idx"
  ON "scan_ordering_sessions"("store_id", "table_id", "club_user_id", "dining_round_id");
CREATE INDEX "scan_ordering_sessions_round_status_idx"
  ON "scan_ordering_sessions"("dining_round_id", "status");
CREATE INDEX "scan_orders_club_user_round_created_at_idx"
  ON "scan_orders"("club_user_id", "dining_round_id", "created_at" DESC);
CREATE INDEX "scan_orders_store_table_round_created_at_idx"
  ON "scan_orders"("store_id", "table_id", "dining_round_id", "created_at" DESC);
