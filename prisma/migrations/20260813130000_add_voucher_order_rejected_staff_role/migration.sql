-- 团购券订单商家端管理：新增拒绝操作员角色快照（owner=主账号/manager=店长/staff=收银员）
ALTER TABLE "club_voucher_orders" ADD COLUMN "rejected_by_staff_role" TEXT;
