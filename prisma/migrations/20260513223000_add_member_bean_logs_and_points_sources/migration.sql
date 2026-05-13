-- CreateEnum
CREATE TYPE "MemberPointsSource" AS ENUM ('purchase_bonus', 'deduct_payment', 'admin_adjust', 'expire');

-- CreateEnum
CREATE TYPE "MemberBeanSource" AS ENUM ('promo_reward', 'deduct_payment', 'withdrawal', 'admin_adjust');

-- AlterTable
ALTER TABLE "member_points_logs"
  ADD COLUMN "source" "MemberPointsSource" NOT NULL DEFAULT 'admin_adjust',
  ADD COLUMN "expires_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "member_points_logs_source_created_at_idx"
  ON "member_points_logs"("source", "created_at");

-- CreateTable
CREATE TABLE "member_bean_logs" (
    "id" SERIAL NOT NULL,
    "member_id" INTEGER NOT NULL,
    "store_id" INTEGER NOT NULL,
    "operator_staff_id" INTEGER,
    "source" "MemberBeanSource" NOT NULL,
    "change_amount" INTEGER NOT NULL,
    "before_balance" INTEGER NOT NULL,
    "after_balance" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "related_promo_id" TEXT,
    "related_user" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_bean_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "member_bean_logs_member_id_created_at_idx"
  ON "member_bean_logs"("member_id", "created_at");

-- CreateIndex
CREATE INDEX "member_bean_logs_store_id_created_at_idx"
  ON "member_bean_logs"("store_id", "created_at");

-- CreateIndex
CREATE INDEX "member_bean_logs_operator_staff_id_created_at_idx"
  ON "member_bean_logs"("operator_staff_id", "created_at");

-- CreateIndex
CREATE INDEX "member_bean_logs_source_created_at_idx"
  ON "member_bean_logs"("source", "created_at");

-- AddForeignKey
ALTER TABLE "member_bean_logs"
  ADD CONSTRAINT "member_bean_logs_member_id_fkey"
  FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_bean_logs"
  ADD CONSTRAINT "member_bean_logs_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_bean_logs"
  ADD CONSTRAINT "member_bean_logs_operator_staff_id_fkey"
  FOREIGN KEY ("operator_staff_id") REFERENCES "staffs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
