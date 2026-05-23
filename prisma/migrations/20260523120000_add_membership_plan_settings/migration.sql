-- CreateEnum
CREATE TYPE "MembershipPlanSettingId" AS ENUM (
  'monthly',
  'quarterly',
  'yearly',
  'lifetime'
);

-- CreateTable
CREATE TABLE "membership_plan_settings" (
    "id" SERIAL NOT NULL,
    "plan_id" "MembershipPlanSettingId" NOT NULL,
    "plan_name" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "original_price" INTEGER,
    "duration_months" INTEGER,
    "valid_days" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "membership_plan_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "membership_plan_settings_plan_id_key"
  ON "membership_plan_settings"("plan_id");

-- Seed default settings
INSERT INTO "membership_plan_settings" (
  "plan_id",
  "plan_name",
  "price",
  "original_price",
  "duration_months",
  "valid_days",
  "updated_at"
)
VALUES
  ('monthly', '月度会员', 3800, 3800, 1, NULL, CURRENT_TIMESTAMP),
  ('quarterly', '季度会员', 9900, 11400, 3, NULL, CURRENT_TIMESTAMP),
  ('yearly', '年度会员', 36900, 45600, 12, NULL, CURRENT_TIMESTAMP),
  ('lifetime', '永久会员', 39800, NULL, NULL, 730, CURRENT_TIMESTAMP);
