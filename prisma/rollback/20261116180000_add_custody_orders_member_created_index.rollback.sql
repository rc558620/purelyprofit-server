-- 回滚：撤销「我的客存」会员维度 keyset 分页索引
DROP INDEX IF EXISTS "idx_custody_orders_store_member_created";
