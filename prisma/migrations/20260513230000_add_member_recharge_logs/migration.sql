-- CreateEnum
CREATE TYPE "MemberRechargeChannel" AS ENUM ('wechat', 'alipay', 'card');

-- CreateTable
CREATE TABLE "member_recharge_logs" (
    "id" SERIAL NOT NULL,
    "member_id" INTEGER NOT NULL,
    "store_id" INTEGER NOT NULL,
    "operator_staff_id" INTEGER,
    "plan_name" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "points_awarded" INTEGER NOT NULL DEFAULT 0,
    "channel" "MemberRechargeChannel" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_recharge_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "member_recharge_logs_member_id_created_at_idx"
  ON "member_recharge_logs"("member_id", "created_at");

-- CreateIndex
CREATE INDEX "member_recharge_logs_store_id_created_at_idx"
  ON "member_recharge_logs"("store_id", "created_at");

-- CreateIndex
CREATE INDEX "member_recharge_logs_operator_staff_id_created_at_idx"
  ON "member_recharge_logs"("operator_staff_id", "created_at");

-- AddForeignKey
ALTER TABLE "member_recharge_logs"
  ADD CONSTRAINT "member_recharge_logs_member_id_fkey"
  FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_recharge_logs"
  ADD CONSTRAINT "member_recharge_logs_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_recharge_logs"
  ADD CONSTRAINT "member_recharge_logs_operator_staff_id_fkey"
  FOREIGN KEY ("operator_staff_id") REFERENCES "staffs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
