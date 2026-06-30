-- AlterTable: 为 marketing_recharges 表增加 total_amount 列
-- total_amount = amount + gift_amount，由后端写入时计算
ALTER TABLE "marketing_recharges" ADD COLUMN "total_amount" INTEGER NOT NULL DEFAULT 0;

-- 回填：为已有记录计算 total_amount = amount + gift_amount
UPDATE "marketing_recharges" SET "total_amount" = "amount" + "gift_amount" WHERE "total_amount" = 0;
