-- AlterTable: 空间会话新增开台操作员字段
ALTER TABLE "space_sessions" ADD COLUMN "open_operator_staff_id" INTEGER;
ALTER TABLE "space_sessions" ADD COLUMN "open_operator_name_snapshot" TEXT;

-- AddForeignKey: 开台操作员 FK → Staff
ALTER TABLE "space_sessions" ADD CONSTRAINT "space_sessions_open_operator_staff_id_fkey"
  FOREIGN KEY ("open_operator_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
