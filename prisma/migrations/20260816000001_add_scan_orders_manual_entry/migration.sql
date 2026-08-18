-- 录入订单状态机改造：scan_orders 表扩展，支持手工补录单走扫码订单状态机（接单/出餐/拒单）
-- 对应 prisma/prisma/purely-profit/operations/schema.prisma 中 ScanOrders model 变更

-- 改 table_id 为可空：takeaway（自取）与 platform（第三方外卖）模式无桌台
ALTER TABLE "scan_orders" ALTER COLUMN "table_id" DROP NOT NULL;

-- 新增手工补录标识：是否来自录入订单（默认为 false，扫码单不受影响）
ALTER TABLE "scan_orders" ADD COLUMN "manual_entry" BOOLEAN NOT NULL DEFAULT false;

-- 手工补录单元数据快照：存放 diningMode / paymentMethod / sourceChannel / externalOrderNo / guestCount / customerPhone / voucherAmount
-- 采用 JSONB 最小侵入方式，避免大量可空字段；读取时由应用层做类型收窄
ALTER TABLE "scan_orders" ADD COLUMN "manual_entry_metadata" JSONB;

-- 索引：手工单过滤与状态聚合加速（dashboard pending 计数 / 桌台聚合 / 订单列表）
CREATE INDEX "scan_orders_store_id_manual_entry_idx" ON "scan_orders" ("store_id", "manual_entry");