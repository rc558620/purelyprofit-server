-- 会员订单渠道：新增「后台设置（计入收入）」与「后台赠送（不计入）」。
--
-- Pulse 管理端「设置会员等级」从本次起落一条会员订单，用于：
--   1. 按「是否计入收入」开关决定是否计入平台营收
--   2. 会员详情页「设置会员等级记录」模块复用充值记录做 tab 展示
-- 存量数据不受影响（枚举只追加取值，不改写既有行）。
--
-- 注意：ADD VALUE 不能在同一个事务里被后续语句立即使用，
-- 因此这里只做枚举扩展，渠道的读写由代码层控制。

ALTER TYPE "MembershipPaymentChannel" ADD VALUE IF NOT EXISTS 'admin';
ALTER TYPE "MembershipPaymentChannel" ADD VALUE IF NOT EXISTS 'gift';
