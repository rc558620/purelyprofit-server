-- DropIndex
DROP INDEX IF EXISTS "store_partners_store_id_key";

-- CreateIndex
CREATE INDEX "store_partners_store_id_status_updated_at_idx"
  ON "store_partners"("store_id", "status", "updated_at");
