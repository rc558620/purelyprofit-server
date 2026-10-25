-- 回滚：删除平台收款支付单表与配套枚举

DROP INDEX IF EXISTS "platform_payment_orders_pay_mode_created_at_idx";
DROP INDEX IF EXISTS "platform_payment_orders_store_id_status_idx";
DROP INDEX IF EXISTS "platform_payment_orders_store_id_biz_type_created_at_idx";
DROP INDEX IF EXISTS "platform_payment_orders_order_no_key";

DROP TABLE IF EXISTS "platform_payment_orders";

DROP TYPE IF EXISTS "PlatformPayMode";
DROP TYPE IF EXISTS "PlatformPaymentStatus";
DROP TYPE IF EXISTS "PlatformPaymentBizType";
