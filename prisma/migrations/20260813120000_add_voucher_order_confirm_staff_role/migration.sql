-- 团购券订单商家确认操作员角色快照（owner=主账号/manager=店长/staff=收银员），供商家端按角色着色展示
ALTER TABLE "club_voucher_orders" ADD COLUMN "confirmed_by_staff_role" TEXT;
