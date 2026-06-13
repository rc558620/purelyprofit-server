-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL variants, enum values must be added one at a time.
ALTER TYPE "MarketingPromotionType" ADD VALUE 'points_recharge';
ALTER TYPE "MarketingPromotionType" ADD VALUE 'discount_day';
