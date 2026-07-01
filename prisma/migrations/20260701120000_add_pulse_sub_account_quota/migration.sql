-- Add pulse_sub_account_quota column to store_membership_profiles
--
-- 将 Pulse 子账号配额与 Profit 订阅席位配额解耦。
-- subAccountQuota 继续由订阅系统管理（席位上限），
-- pulse_sub_account_quota 由 Pulse 管理端独立写入，
-- null 表示 Pulse 从未显式配置过配额（默认关闭）。

ALTER TABLE store_membership_profiles
  ADD COLUMN pulse_sub_account_quota INTEGER;
