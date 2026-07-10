-- Data backfill: 为已有团购订单回填 customer_payment_method
-- 从 space_sessions.prepaid_customer_payment_method 同步到对应的 sale_orders.customer_payment_method
UPDATE sale_orders so
SET customer_payment_method = ss.prepaid_customer_payment_method
FROM space_sessions ss
WHERE ss.sale_order_id = so.id
  AND ss.prepaid_customer_payment_method IS NOT NULL
  AND so.customer_payment_method IS NULL;

-- Data backfill: 回填平台结算字段（从 space_sessions 同步到 sale_orders）
UPDATE sale_orders so
SET
  settlement_status        = COALESCE(so.settlement_status, ss.settlement_status),
  platform_receivable      = COALESCE(so.platform_receivable, ss.platform_receivable),
  platform_settled_amount  = COALESCE(so.platform_settled_amount, ss.platform_settled_amount),
  platform_fee             = COALESCE(so.platform_fee, ss.platform_fee)
FROM space_sessions ss
WHERE ss.sale_order_id = so.id
  AND ss.prepaid_customer_payment_method = 'groupon_voucher'
  AND (so.settlement_status IS NULL OR so.platform_receivable IS NULL);
