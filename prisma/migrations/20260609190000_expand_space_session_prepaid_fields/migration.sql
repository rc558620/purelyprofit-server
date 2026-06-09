ALTER TABLE "space_sessions"
  ADD COLUMN "prepaid_customer_payment_method" TEXT,
  ADD COLUMN "prepaid_settlement_channel" TEXT,
  ADD COLUMN "prepaid_groupon_platform" TEXT,
  ADD COLUMN "prepaid_voucher_code" TEXT,
  ADD COLUMN "prepaid_voucher_platform" TEXT,
  ADD COLUMN "prepaid_voucher_face_amount" DECIMAL(12,2);
