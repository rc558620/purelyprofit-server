-- AlterTable
ALTER TABLE "space_sessions" ADD COLUMN "settlement_status" TEXT;
ALTER TABLE "space_sessions" ADD COLUMN "platform_receivable" INTEGER;
ALTER TABLE "space_sessions" ADD COLUMN "platform_settled_amount" INTEGER;
ALTER TABLE "space_sessions" ADD COLUMN "platform_fee" INTEGER;
ALTER TABLE "space_sessions" ADD COLUMN "time_fee_mode" TEXT;
