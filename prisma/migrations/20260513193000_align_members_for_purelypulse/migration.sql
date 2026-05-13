ALTER TYPE "MemberStatus" ADD VALUE IF NOT EXISTS 'BANNED';

ALTER TABLE "members"
  ADD COLUMN "total_points_earned" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "bean_balance" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "is_partner" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "partner_level" TEXT,
  ADD COLUMN "total_recharged" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "recharge_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "invited_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "banned_reason" TEXT;

ALTER TABLE "members"
  ALTER COLUMN "level" SET DEFAULT 'free';

UPDATE "members"
SET "level" = 'free'
WHERE "level" = '普通会员';

UPDATE "members"
SET "total_points_earned" = "points"
WHERE "total_points_earned" = 0
  AND "points" > 0;

CREATE INDEX "members_store_id_is_partner_updated_at_idx"
  ON "members"("store_id", "is_partner", "updated_at");
