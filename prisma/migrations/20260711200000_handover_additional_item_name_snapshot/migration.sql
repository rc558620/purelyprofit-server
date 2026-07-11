-- AlterTable: 添加 item_name_snapshot 快照字段（防止删除附加项配置时丢失历史记录中的名称）
ALTER TABLE "store_handover_additional_values" ADD COLUMN "item_name_snapshot" TEXT;

-- Backfill: 从附加项定义表回填已有记录的名称快照
UPDATE "store_handover_additional_values" v
SET "item_name_snapshot" = i."name"
FROM "store_handover_additional_items" i
WHERE v."item_id" = i."id";

-- AlterColumn: 回填完成后设为 NOT NULL
ALTER TABLE "store_handover_additional_values" ALTER COLUMN "item_name_snapshot" SET NOT NULL;

-- DropForeignKey: 删除旧的 CASCADE 外键
ALTER TABLE "store_handover_additional_values" DROP CONSTRAINT "store_handover_additional_values_item_id_fkey";

-- AddForeignKey: 重建外键，使用 RESTRICT 保护历史数据完整性
ALTER TABLE "store_handover_additional_values" ADD CONSTRAINT "store_handover_additional_values_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "store_handover_additional_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
