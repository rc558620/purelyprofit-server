-- 优惠拆解快照：下单时后端生成的优惠明细展示行（会员售价/等级折扣/活动折扣/满减/小计）
ALTER TABLE "club_voucher_orders" ADD COLUMN "breakdown_items" JSONB;
