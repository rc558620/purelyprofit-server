-- ═══════════════════════════════════════════════════════════════════════
-- Fix CHECK constraints: allow negative values for deduction items
--
-- 空间结账场景中，续费抵扣和预付抵扣的 salePrice/profit 为负数，
-- 导致 sale_order_items / space_session_items 的 CHECK 约束被违反。
-- 同时 totalRevenue / totalProfit 在抵扣超过收入时也可能为负数。
--
-- 两批来源的约束需要同时处理：
--   1) step6 (20260626120000) 创建的 *_gte_0 约束
--   2) safety (20260627000000) 创建的无后缀约束
--
-- 修复方式：DROP 冲突约束，保留 quantity 相关约束（数量不应为负）。
-- ═══════════════════════════════════════════════════════════════════════

-- ── sale_orders ──────────────────────────────────────────────────────
-- totalRevenue / totalProfit 可为负（抵扣超过收入时）

-- 来源: step6 (20260626120000)
ALTER TABLE sale_orders DROP CONSTRAINT IF EXISTS chk_sale_orders_total_revenue_gte_0;

-- 来源: safety (20260627000000)
ALTER TABLE sale_orders DROP CONSTRAINT IF EXISTS chk_sale_orders_total_revenue;
ALTER TABLE sale_orders DROP CONSTRAINT IF EXISTS chk_sale_orders_total_profit;

-- 保留 totalQuantity >= 0 / > 0，数量不应为负
-- chk_sale_orders_total_quantity / chk_sale_orders_total_quantity_gt_0 保持不变

-- ── sale_order_items ─────────────────────────────────────────────────
-- salePrice / profit 可为负（抵扣行：续费抵扣、预付抵扣）

-- 来源: step6 (20260626120000)
ALTER TABLE sale_order_items DROP CONSTRAINT IF EXISTS chk_sale_order_items_sale_price_gte_0;

-- 来源: safety (20260627000000)
ALTER TABLE sale_order_items DROP CONSTRAINT IF EXISTS chk_sale_order_items_sale_price;
ALTER TABLE sale_order_items DROP CONSTRAINT IF EXISTS chk_sale_order_items_profit;

-- 保留 quantity >= 0 / > 0，数量不应为负
-- chk_sale_order_items_quantity / chk_sale_order_items_quantity_gt_0 保持不变

-- ── space_session_items ─────────────────────────────────────────────
-- salePrice / profit 可为负（抵扣行写入 space_session_items）

-- 来源: safety (20260627000000)
ALTER TABLE space_session_items DROP CONSTRAINT IF EXISTS chk_space_session_items_sale_price;
ALTER TABLE space_session_items DROP CONSTRAINT IF EXISTS chk_space_session_items_profit;

-- 保留 quantity >= 0，数量不应为负
-- chk_space_session_items_quantity 保持不变

-- ── finance_cash_flow_records ────────────────────────────────────────
-- amount 允许为零（空间结账含抵扣时 totalRevenue 可为零），
-- 应用层已保护：totalRevenue <= 0 时不创建现金流记录。
-- 放宽 step6 的 > 0 约束为 >= 0（safety 的 >= 0 已足够），以应对边界值。

-- 来源: step6 (20260626120000) — amount > 0 过严，放宽为 >= 0
ALTER TABLE finance_cash_flow_records DROP CONSTRAINT IF EXISTS chk_finance_cash_flow_records_amount_gt_0;

-- 来源: safety (20260627000000) — amount >= 0 保留，与放宽后的语义一致
-- chk_finance_cash_flow_records_amount 保持不变
