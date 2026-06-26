-- ═══════════════════════════════════════════════════════════
-- Safety & Performance: Partial Unique Indexes + CHECK constraints
-- ═══════════════════════════════════════════════════════════

-- 1. CostRecord: Partial Unique Index for (storeId, sourceType, purchaseOrderId)
--    Only enforces uniqueness when purchaseOrderId IS NOT NULL
--    (replaces Prisma @@unique which was removed because onDelete: SetNull can nullify the FK)
CREATE UNIQUE INDEX IF NOT EXISTS cost_records_store_source_purchase_unique
  ON cost_records (store_id, source_type, purchase_order_id)
  WHERE purchase_order_id IS NOT NULL;

-- 2. CostRecord: Partial Unique Index for (storeId, sourceType, payrollId)
--    Only enforces uniqueness when payrollId IS NOT NULL
CREATE UNIQUE INDEX IF NOT EXISTS cost_records_store_source_payroll_unique
  ON cost_records (store_id, source_type, payroll_id)
  WHERE payroll_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════
-- CHECK constraints:金额字段 ≥ 0
-- 防止应用层漏洞导致负数金额写入数据库
-- ═══════════════════════════════════════════════════════════

-- MarketingCustomer: balance, points, totalSpent, visitCount
ALTER TABLE marketing_customers ADD CONSTRAINT chk_marketing_customers_balance CHECK (balance >= 0);
ALTER TABLE marketing_customers ADD CONSTRAINT chk_marketing_customers_points CHECK (points >= 0);
ALTER TABLE marketing_customers ADD CONSTRAINT chk_marketing_customers_total_spent CHECK (total_spent >= 0);
ALTER TABLE marketing_customers ADD CONSTRAINT chk_marketing_customers_visit_count CHECK (visit_count >= 0);

-- MarketingRecharge: amount, giftAmount
ALTER TABLE marketing_recharges ADD CONSTRAINT chk_marketing_recharges_amount CHECK (amount >= 0);
ALTER TABLE marketing_recharges ADD CONSTRAINT chk_marketing_recharges_gift_amount CHECK (gift_amount >= 0);

-- MarketingConsumption: amount, balancePaid, pointsDeducted
ALTER TABLE marketing_consumptions ADD CONSTRAINT chk_marketing_consumptions_amount CHECK (amount >= 0);
ALTER TABLE marketing_consumptions ADD CONSTRAINT chk_marketing_consumptions_balance_paid CHECK (balance_paid >= 0);
ALTER TABLE marketing_consumptions ADD CONSTRAINT chk_marketing_consumptions_points_deducted CHECK (points_deducted >= 0);

-- Member: beanBalance
ALTER TABLE members ADD CONSTRAINT chk_members_bean_balance CHECK (bean_balance >= 0);

-- EmployeePayroll: baseSalary, leaveDeduction, otherDeduction, bonus, actualSalary, socialInsurance, housingFund, totalLaborCost
ALTER TABLE employee_payrolls ADD CONSTRAINT chk_employee_payrolls_base_salary CHECK (base_salary >= 0);
ALTER TABLE employee_payrolls ADD CONSTRAINT chk_employee_payrolls_leave_deduction CHECK (leave_deduction >= 0);
ALTER TABLE employee_payrolls ADD CONSTRAINT chk_employee_payrolls_other_deduction CHECK (other_deduction >= 0);
ALTER TABLE employee_payrolls ADD CONSTRAINT chk_employee_payrolls_bonus CHECK (bonus >= 0);
ALTER TABLE employee_payrolls ADD CONSTRAINT chk_employee_payrolls_actual_salary CHECK (actual_salary >= 0);
ALTER TABLE employee_payrolls ADD CONSTRAINT chk_employee_payrolls_social_insurance CHECK (social_insurance >= 0);
ALTER TABLE employee_payrolls ADD CONSTRAINT chk_employee_payrolls_housing_fund CHECK (housing_fund >= 0);
ALTER TABLE employee_payrolls ADD CONSTRAINT chk_employee_payrolls_total_labor_cost CHECK (total_labor_cost >= 0);

-- CostRecord: amount
ALTER TABLE cost_records ADD CONSTRAINT chk_cost_records_amount CHECK (amount >= 0);

-- FinanceAccountRecord: amount, paidAmount, remaining
ALTER TABLE finance_account_records ADD CONSTRAINT chk_finance_account_records_amount CHECK (amount >= 0);
ALTER TABLE finance_account_records ADD CONSTRAINT chk_finance_account_records_paid_amount CHECK (paid_amount >= 0);
ALTER TABLE finance_account_records ADD CONSTRAINT chk_finance_account_records_remaining CHECK (remaining >= 0);

-- FinanceCashFlowRecord: amount
ALTER TABLE finance_cash_flow_records ADD CONSTRAINT chk_finance_cash_flow_records_amount CHECK (amount >= 0);

-- SaleOrder: totalRevenue, totalProfit, totalQuantity
ALTER TABLE sale_orders ADD CONSTRAINT chk_sale_orders_total_revenue CHECK (total_revenue >= 0);
ALTER TABLE sale_orders ADD CONSTRAINT chk_sale_orders_total_profit CHECK (total_profit >= 0);
ALTER TABLE sale_orders ADD CONSTRAINT chk_sale_orders_total_quantity CHECK (total_quantity >= 0);

-- SaleOrderItem: salePrice, profit, quantity
ALTER TABLE sale_order_items ADD CONSTRAINT chk_sale_order_items_sale_price CHECK (sale_price >= 0);
ALTER TABLE sale_order_items ADD CONSTRAINT chk_sale_order_items_profit CHECK (profit >= 0);
ALTER TABLE sale_order_items ADD CONSTRAINT chk_sale_order_items_quantity CHECK (quantity >= 0);

-- PurchaseOrder: totalAmount
ALTER TABLE purchase_orders ADD CONSTRAINT chk_purchase_orders_total_amount CHECK (total_amount >= 0);

-- PurchaseOrderItem: unitPrice, amount, quantity
ALTER TABLE purchase_order_items ADD CONSTRAINT chk_purchase_order_items_unit_price CHECK (unit_price >= 0);
ALTER TABLE purchase_order_items ADD CONSTRAINT chk_purchase_order_items_amount CHECK (amount >= 0);
ALTER TABLE purchase_order_items ADD CONSTRAINT chk_purchase_order_items_quantity CHECK (quantity >= 0);

-- Product: price, profit, costPrice, stock, alertThreshold
ALTER TABLE products ADD CONSTRAINT chk_products_price CHECK (price >= 0);
ALTER TABLE products ADD CONSTRAINT chk_products_profit CHECK (profit >= 0);
ALTER TABLE products ADD CONSTRAINT chk_products_cost_price CHECK (cost_price >= 0);
ALTER TABLE products ADD CONSTRAINT chk_products_stock CHECK (stock >= 0);
ALTER TABLE products ADD CONSTRAINT chk_products_alert_threshold CHECK (alert_threshold >= 0);

-- SpaceSession: hourlyRate, timeCost, itemsCost, prepaidAmount, prepaidVoucherFaceAmount
ALTER TABLE space_sessions ADD CONSTRAINT chk_space_sessions_hourly_rate CHECK (hourly_rate IS NULL OR hourly_rate >= 0);
ALTER TABLE space_sessions ADD CONSTRAINT chk_space_sessions_time_cost CHECK (time_cost IS NULL OR time_cost >= 0);
ALTER TABLE space_sessions ADD CONSTRAINT chk_space_sessions_items_cost CHECK (items_cost >= 0);
ALTER TABLE space_sessions ADD CONSTRAINT chk_space_sessions_prepaid_amount CHECK (prepaid_amount IS NULL OR prepaid_amount >= 0);
ALTER TABLE space_sessions ADD CONSTRAINT chk_space_sessions_prepaid_voucher_face_amount CHECK (prepaid_voucher_face_amount IS NULL OR prepaid_voucher_face_amount >= 0);

-- SpaceSessionItem: salePrice, profit, quantity
ALTER TABLE space_session_items ADD CONSTRAINT chk_space_session_items_sale_price CHECK (sale_price >= 0);
ALTER TABLE space_session_items ADD CONSTRAINT chk_space_session_items_profit CHECK (profit >= 0);
ALTER TABLE space_session_items ADD CONSTRAINT chk_space_session_items_quantity CHECK (quantity >= 0);

-- SpaceSessionRenewRecord: amount, addedMinutes
ALTER TABLE space_session_renew_records ADD CONSTRAINT chk_space_session_renew_records_amount CHECK (amount >= 0);
ALTER TABLE space_session_renew_records ADD CONSTRAINT chk_space_session_renew_records_added_minutes CHECK (added_minutes >= 0);

-- MarketingProduct: price, originalPrice, stock
ALTER TABLE marketing_products ADD CONSTRAINT chk_marketing_products_price CHECK (price >= 0);
ALTER TABLE marketing_products ADD CONSTRAINT chk_marketing_products_original_price CHECK (original_price IS NULL OR original_price >= 0);
ALTER TABLE marketing_products ADD CONSTRAINT chk_marketing_products_stock CHECK (stock >= 0);

-- StorePartner: beanBalance, totalEarnedBeans, totalWithdrawnBeans
ALTER TABLE store_partners ADD CONSTRAINT chk_store_partners_bean_balance CHECK (bean_balance >= 0);
ALTER TABLE store_partners ADD CONSTRAINT chk_store_partners_total_earned_beans CHECK (total_earned_beans >= 0);
ALTER TABLE store_partners ADD CONSTRAINT chk_store_partners_total_withdrawn_beans CHECK (total_withdrawn_beans >= 0);

-- PartnerWithdrawal: beanAmount, rmbAmount
ALTER TABLE partner_withdrawals ADD CONSTRAINT chk_partner_withdrawals_bean_amount CHECK (bean_amount >= 0);
ALTER TABLE partner_withdrawals ADD CONSTRAINT chk_partner_withdrawals_rmb_amount CHECK (rmb_amount >= 0);

-- MembershipPlanSetting: price, originalPrice, durationMonths, validDays
ALTER TABLE membership_plan_settings ADD CONSTRAINT chk_membership_plan_settings_price CHECK (price >= 0);
ALTER TABLE membership_plan_settings ADD CONSTRAINT chk_membership_plan_settings_original_price CHECK (original_price IS NULL OR original_price >= 0);
ALTER TABLE membership_plan_settings ADD CONSTRAINT chk_membership_plan_settings_duration_months CHECK (duration_months IS NULL OR duration_months >= 0);
ALTER TABLE membership_plan_settings ADD CONSTRAINT chk_membership_plan_settings_valid_days CHECK (valid_days IS NULL OR valid_days >= 0);

-- StoreMembershipProfile: totalPoints, availablePoints, subAccountQuota
ALTER TABLE store_membership_profiles ADD CONSTRAINT chk_store_membership_profiles_total_points CHECK (total_points >= 0);
ALTER TABLE store_membership_profiles ADD CONSTRAINT chk_store_membership_profiles_available_points CHECK (available_points >= 0);
ALTER TABLE store_membership_profiles ADD CONSTRAINT chk_store_membership_profiles_sub_account_quota CHECK (sub_account_quota >= 0);

-- StoreMembershipOrder: originalAmount, pointsUsed, beansUsed, amount
ALTER TABLE store_membership_orders ADD CONSTRAINT chk_store_membership_orders_original_amount CHECK (original_amount >= 0);
ALTER TABLE store_membership_orders ADD CONSTRAINT chk_store_membership_orders_points_used CHECK (points_used >= 0);
ALTER TABLE store_membership_orders ADD CONSTRAINT chk_store_membership_orders_beans_used CHECK (beans_used >= 0);
ALTER TABLE store_membership_orders ADD CONSTRAINT chk_store_membership_orders_amount CHECK (amount >= 0);

-- StoreMembershipPointsLog: changeAmount
ALTER TABLE store_membership_points_logs ADD CONSTRAINT chk_store_membership_points_logs_change_amount CHECK (change_amount >= 0);

-- StoreMembershipPromoRecord: rewardBeans
ALTER TABLE store_membership_promo_records ADD CONSTRAINT chk_store_membership_promo_records_reward_beans CHECK (reward_beans IS NULL OR reward_beans >= 0);

-- Employee: baseSalary
ALTER TABLE employees ADD CONSTRAINT chk_employees_base_salary CHECK (base_salary >= 0);

-- EmployeeLeave: deductAmount
ALTER TABLE employee_leaves ADD CONSTRAINT chk_employee_leaves_deduct_amount CHECK (deduct_amount >= 0);

-- FinanceReconciliationRecord: all amount fields
ALTER TABLE finance_reconciliation_records ADD CONSTRAINT chk_finance_reconciliation_records_book_income CHECK (book_income >= 0);
ALTER TABLE finance_reconciliation_records ADD CONSTRAINT chk_finance_reconciliation_records_book_expense CHECK (book_expense >= 0);
ALTER TABLE finance_reconciliation_records ADD CONSTRAINT chk_finance_reconciliation_records_actual_income CHECK (actual_income >= 0);
ALTER TABLE finance_reconciliation_records ADD CONSTRAINT chk_finance_reconciliation_records_actual_expense CHECK (actual_expense >= 0);

-- FinanceReconciliationItem: bookAmount, actualAmount
ALTER TABLE finance_reconciliation_items ADD CONSTRAINT chk_finance_reconciliation_items_book_amount CHECK (book_amount >= 0);
ALTER TABLE finance_reconciliation_items ADD CONSTRAINT chk_finance_reconciliation_items_actual_amount CHECK (actual_amount >= 0);
