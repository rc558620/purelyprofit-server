-- 新增系统超时自动退款触发类型：商家超时未接单 / 超时未出餐时系统自动退款
ALTER TYPE "ScanOrderRefundTrigger" ADD VALUE IF NOT EXISTS 'system_timeout';
