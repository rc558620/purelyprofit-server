-- D4: 新增「实际扣减积分个数」列，与 points_deducted（金额，分）配合，
-- 写入时由 redeemRatioPoints 折算固化，保证双字段可独立核对。
ALTER TABLE "marketing_consumptions" ADD COLUMN "actual_points_deducted" INTEGER NOT NULL DEFAULT 0;
