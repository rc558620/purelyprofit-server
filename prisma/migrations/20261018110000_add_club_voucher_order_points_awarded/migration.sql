-- AlterTable
-- 团购券订单补充「结算时赠送的积分个数」快照。
-- 退款必须按「当时实际赠送」的数量回收：重算不可靠（积分规则开关、双倍积分活动
-- 都可能已变化），而积分流水中没有订单号无法反查。
-- 历史已结算订单没有该快照，默认值 0 表示退款时不回收，不影响既有数据。
ALTER TABLE "club_voucher_orders" ADD COLUMN "points_awarded" INTEGER NOT NULL DEFAULT 0;
