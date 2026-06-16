-- FixDrift: align store_partners indexes with schema
-- 1. Drop the unique index on store_id (if exists) — support multiple partners per store
DROP INDEX IF EXISTS "store_partners_store_id_key";

-- 2. Create composite index (if not exists)
CREATE INDEX IF NOT EXISTS "store_partners_store_id_status_updated_at_idx"
  ON "store_partners"("store_id", "status", "updated_at");
