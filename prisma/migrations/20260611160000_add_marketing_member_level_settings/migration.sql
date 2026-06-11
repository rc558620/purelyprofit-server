CREATE TABLE "marketing_member_level_settings" (
  "id" SERIAL NOT NULL,
  "store_id" INTEGER NOT NULL,
  "levels" JSONB NOT NULL DEFAULT '[]',
  "points_ratio" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "marketing_member_level_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "marketing_member_level_settings_store_id_key"
  ON "marketing_member_level_settings"("store_id");

ALTER TABLE "marketing_member_level_settings"
  ADD CONSTRAINT "marketing_member_level_settings_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
