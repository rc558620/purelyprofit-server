-- CreateEnum
CREATE TYPE "PartnerIntention" AS ENUM (
  'agent',
  'invest',
  'resource',
  'other'
);

-- AlterTable
ALTER TABLE "store_partners"
  ADD COLUMN "region" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "intention" "PartnerIntention",
  ADD COLUMN "apply_reason" TEXT;

-- CreateTable
CREATE TABLE "store_membership_points_logs" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "profile_id" INTEGER NOT NULL,
    "source" "MemberPointsSource" NOT NULL,
    "change_amount" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "expire_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_membership_points_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_membership_promo_records" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "invitee_name" TEXT NOT NULL,
    "invitee_phone" TEXT NOT NULL,
    "registered_at" TIMESTAMP(3) NOT NULL,
    "has_charged" BOOLEAN NOT NULL DEFAULT false,
    "charged_amount" INTEGER,
    "charged_at" TIMESTAMP(3),
    "charged_plan" "MembershipPlanCycle",
    "reward_beans" INTEGER,
    "settled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_membership_promo_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_partner_bean_logs" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "partner_id" INTEGER NOT NULL,
    "source" "MemberBeanSource" NOT NULL,
    "change_amount" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "related_promo_record_id" INTEGER,
    "related_user" TEXT,
    "related_plan_type" "MembershipPlanCycle",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_partner_bean_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "store_membership_points_logs_store_id_created_at_idx"
  ON "store_membership_points_logs"("store_id", "created_at");

-- CreateIndex
CREATE INDEX "store_membership_points_logs_profile_id_created_at_idx"
  ON "store_membership_points_logs"("profile_id", "created_at");

-- CreateIndex
CREATE INDEX "store_membership_points_logs_source_created_at_idx"
  ON "store_membership_points_logs"("source", "created_at");

-- CreateIndex
CREATE INDEX "store_membership_promo_records_store_id_registered_at_idx"
  ON "store_membership_promo_records"("store_id", "registered_at");

-- CreateIndex
CREATE INDEX "store_membership_promo_records_store_id_has_charged_registered_at_idx"
  ON "store_membership_promo_records"("store_id", "has_charged", "registered_at");

-- CreateIndex
CREATE INDEX "store_membership_promo_records_charged_at_idx"
  ON "store_membership_promo_records"("charged_at");

-- CreateIndex
CREATE INDEX "store_partner_bean_logs_store_id_created_at_idx"
  ON "store_partner_bean_logs"("store_id", "created_at");

-- CreateIndex
CREATE INDEX "store_partner_bean_logs_partner_id_created_at_idx"
  ON "store_partner_bean_logs"("partner_id", "created_at");

-- CreateIndex
CREATE INDEX "store_partner_bean_logs_source_created_at_idx"
  ON "store_partner_bean_logs"("source", "created_at");

-- AddForeignKey
ALTER TABLE "store_membership_points_logs"
  ADD CONSTRAINT "store_membership_points_logs_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_membership_points_logs"
  ADD CONSTRAINT "store_membership_points_logs_profile_id_fkey"
  FOREIGN KEY ("profile_id") REFERENCES "store_membership_profiles"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_membership_promo_records"
  ADD CONSTRAINT "store_membership_promo_records_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_partner_bean_logs"
  ADD CONSTRAINT "store_partner_bean_logs_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_partner_bean_logs"
  ADD CONSTRAINT "store_partner_bean_logs_partner_id_fkey"
  FOREIGN KEY ("partner_id") REFERENCES "store_partners"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
