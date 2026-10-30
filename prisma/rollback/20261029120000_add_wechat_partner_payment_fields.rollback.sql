-- 回滚：撤销服务商模式新增的列、索引与枚举
-- ⚠️ 回滚前必须先把 WECHAT_PARTNER_ENABLED 置为 false 并重启，
-- 避免运行中的进程仍在读写这些列。

DROP INDEX IF EXISTS "club_recharge_orders_sub_mch_id_idx";
DROP INDEX IF EXISTS "store_wechat_pay_configs_bind_status_idx";
DROP INDEX IF EXISTS "store_wechat_pay_configs_sub_mch_id_idx";

ALTER TABLE "club_recharge_orders"
    DROP COLUMN IF EXISTS "sp_mch_id",
    DROP COLUMN IF EXISTS "sub_mch_id";

ALTER TABLE "club_voucher_orders"
    DROP COLUMN IF EXISTS "sp_mch_id",
    DROP COLUMN IF EXISTS "sub_mch_id";

ALTER TABLE "scan_order_payment_attempts"
    DROP COLUMN IF EXISTS "sp_mch_id",
    DROP COLUMN IF EXISTS "sub_mch_id";

ALTER TABLE "self_order_payment_attempts"
    DROP COLUMN IF EXISTS "sp_mch_id",
    DROP COLUMN IF EXISTS "sub_mch_id";

ALTER TABLE "store_wechat_pay_configs"
    DROP COLUMN IF EXISTS "sub_mch_id",
    DROP COLUMN IF EXISTS "sub_appid",
    DROP COLUMN IF EXISTS "bind_status",
    DROP COLUMN IF EXISTS "bind_checked_at",
    DROP COLUMN IF EXISTS "bind_fail_reason";

DROP TYPE IF EXISTS "StoreWechatPayBindStatus";
