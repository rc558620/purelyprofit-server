ALTER TABLE "marketing_customers"
  ADD COLUMN "club_user_id" INTEGER;

CREATE UNIQUE INDEX "uq_marketing_customers_store_club_user"
  ON "marketing_customers" ("store_id", "club_user_id")
  WHERE "club_user_id" IS NOT NULL;

CREATE INDEX "idx_marketing_customers_club_user"
  ON "marketing_customers" ("club_user_id")
  WHERE "club_user_id" IS NOT NULL;
