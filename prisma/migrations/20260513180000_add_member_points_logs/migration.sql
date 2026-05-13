-- CreateEnum
CREATE TYPE "MemberPointsChangeType" AS ENUM ('INCREASE', 'DECREASE');

-- CreateTable
CREATE TABLE "member_points_logs" (
    "id" SERIAL NOT NULL,
    "member_id" INTEGER NOT NULL,
    "store_id" INTEGER NOT NULL,
    "operator_staff_id" INTEGER,
    "change_type" "MemberPointsChangeType" NOT NULL,
    "change_amount" INTEGER NOT NULL,
    "before_points" INTEGER NOT NULL,
    "after_points" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "remark" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_points_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "member_points_logs_member_id_created_at_idx" ON "member_points_logs"("member_id", "created_at");

-- CreateIndex
CREATE INDEX "member_points_logs_store_id_created_at_idx" ON "member_points_logs"("store_id", "created_at");

-- CreateIndex
CREATE INDEX "member_points_logs_operator_staff_id_created_at_idx" ON "member_points_logs"("operator_staff_id", "created_at");

-- AddForeignKey
ALTER TABLE "member_points_logs" ADD CONSTRAINT "member_points_logs_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_points_logs" ADD CONSTRAINT "member_points_logs_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_points_logs" ADD CONSTRAINT "member_points_logs_operator_staff_id_fkey" FOREIGN KEY ("operator_staff_id") REFERENCES "staffs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
