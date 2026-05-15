-- CreateTable
CREATE TABLE "store_partner_applications" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "status" "PartnerAccountStatus" NOT NULL DEFAULT 'pending',
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "id_card" TEXT NOT NULL,
    "region" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "intention" "PartnerIntention" NOT NULL,
    "apply_reason" TEXT,
    "payment_account_type" "WithdrawalAccountType" NOT NULL,
    "payment_account_no" TEXT NOT NULL,
    "payment_account_name" TEXT NOT NULL,
    "reviewed_at" TIMESTAMP(3),
    "joined_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_partner_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_partner_application_notes" (
    "id" SERIAL NOT NULL,
    "application_id" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_partner_application_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "store_partner_applications_store_id_created_at_idx"
  ON "store_partner_applications"("store_id", "created_at");

-- CreateIndex
CREATE INDEX "store_partner_applications_store_id_status_updated_at_idx"
  ON "store_partner_applications"("store_id", "status", "updated_at");

-- CreateIndex
CREATE INDEX "store_partner_application_notes_application_id_created_at_idx"
  ON "store_partner_application_notes"("application_id", "created_at");

-- AddForeignKey
ALTER TABLE "store_partner_applications"
  ADD CONSTRAINT "store_partner_applications_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_partner_application_notes"
  ADD CONSTRAINT "store_partner_application_notes_application_id_fkey"
  FOREIGN KEY ("application_id") REFERENCES "store_partner_applications"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
