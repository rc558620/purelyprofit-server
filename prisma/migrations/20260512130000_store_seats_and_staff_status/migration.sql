-- CreateEnum
CREATE TYPE "StaffStatus" AS ENUM ('INVITED', 'ACTIVE', 'DISABLED');

-- AlterTable
ALTER TABLE "stores"
ADD COLUMN "max_account_seats" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "staffs"
ADD COLUMN "status" "StaffStatus" NOT NULL DEFAULT 'INVITED',
ADD COLUMN "is_seat_active" BOOLEAN NOT NULL DEFAULT false;

UPDATE "stores"
SET "max_account_seats" = 1;

UPDATE "staffs"
SET "status" = CASE
    WHEN "role" = 'OWNER'::"StaffRole" THEN 'ACTIVE'::"StaffStatus"
    WHEN "is_active" = true AND "user_id" IS NOT NULL THEN 'ACTIVE'::"StaffStatus"
    WHEN "is_active" = true THEN 'INVITED'::"StaffStatus"
    ELSE 'DISABLED'::"StaffStatus"
  END,
  "is_seat_active" = CASE
    WHEN "role" = 'OWNER'::"StaffRole" THEN true
    WHEN "is_active" = true AND "user_id" IS NOT NULL THEN true
    ELSE false
  END;
