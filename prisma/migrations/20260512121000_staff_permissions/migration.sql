-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('OWNER', 'MANAGER', 'STAFF');

-- AlterTable
ALTER TABLE "staffs"
ADD COLUMN "user_id" INTEGER,
ADD COLUMN "email" TEXT,
ADD COLUMN "permissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ALTER COLUMN "role" TYPE "StaffRole" USING (
  CASE
    WHEN "role" = '店长' THEN 'MANAGER'::"StaffRole"
    WHEN "role" = '老板' THEN 'OWNER'::"StaffRole"
    ELSE 'STAFF'::"StaffRole"
  END
),
ALTER COLUMN "role" SET DEFAULT 'STAFF';

UPDATE "staffs"
SET "email" = CONCAT('staff-', "id", '@pending.local')
WHERE "email" IS NULL;

ALTER TABLE "staffs"
ALTER COLUMN "email" SET NOT NULL;

UPDATE "staffs" s
SET "user_id" = u."id"
FROM "users" u
WHERE s."email" = u."email";

INSERT INTO "staffs" (
  "store_id",
  "user_id",
  "email",
  "name",
  "phone",
  "role",
  "permissions",
  "is_active",
  "created_at",
  "updated_at"
)
SELECT
  s."id",
  u."id",
  u."email",
  COALESCE(u."name", s."name"),
  s."contact_phone",
  'OWNER'::"StaffRole",
  ARRAY['*']::TEXT[],
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "stores" s
INNER JOIN "users" u ON u."id" = s."owner_id"
LEFT JOIN "staffs" existing
  ON existing."store_id" = s."id"
 AND existing."email" = u."email"
WHERE existing."id" IS NULL;

-- CreateIndex
CREATE INDEX "staffs_user_id_idx" ON "staffs"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "staffs_store_id_email_key" ON "staffs"("store_id", "email");

-- AddForeignKey
ALTER TABLE "staffs" ADD CONSTRAINT "staffs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
