-- Step 3: 统一金额单位 —— 将所有 Decimal(12,2) 金额字段迁移为 Int（分）
-- 迁移策略：ROUND(旧值 * 100) 将元单位转为分单位，精度损失≤0.5分
-- 注意：五险一金(social_insurance / housing_fund)保留 Decimal，不在本次迁移范围

-- ─────────────────────────────────────────────────────────────────────────────
-- goods: products
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "products"
  ALTER COLUMN "price"       TYPE INT USING ROUND("price" * 100)::INT,
  ALTER COLUMN "profit"      TYPE INT USING ROUND("profit" * 100)::INT,
  ALTER COLUMN "cost_price"  TYPE INT USING CASE WHEN "cost_price" IS NULL THEN NULL ELSE ROUND("cost_price" * 100)::INT END;

-- ─────────────────────────────────────────────────────────────────────────────
-- finance: finance_cash_flow_records
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "finance_cash_flow_records"
  ALTER COLUMN "amount" TYPE INT USING ROUND("amount" * 100)::INT;

-- ─────────────────────────────────────────────────────────────────────────────
-- finance: finance_account_records
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "finance_account_records"
  ALTER COLUMN "amount"       TYPE INT USING ROUND("amount" * 100)::INT,
  ALTER COLUMN "paid_amount"  TYPE INT USING ROUND("paid_amount" * 100)::INT,
  ALTER COLUMN "remaining"    TYPE INT USING ROUND("remaining" * 100)::INT;

-- ─────────────────────────────────────────────────────────────────────────────
-- finance: finance_reconciliation_records
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "finance_reconciliation_records"
  ALTER COLUMN "book_income"    TYPE INT USING ROUND("book_income" * 100)::INT,
  ALTER COLUMN "book_expense"   TYPE INT USING ROUND("book_expense" * 100)::INT,
  ALTER COLUMN "book_net"       TYPE INT USING ROUND("book_net" * 100)::INT,
  ALTER COLUMN "actual_income"  TYPE INT USING ROUND("actual_income" * 100)::INT,
  ALTER COLUMN "actual_expense" TYPE INT USING ROUND("actual_expense" * 100)::INT,
  ALTER COLUMN "actual_net"     TYPE INT USING ROUND("actual_net" * 100)::INT,
  ALTER COLUMN "diff_amount"    TYPE INT USING ROUND("diff_amount" * 100)::INT;

-- ─────────────────────────────────────────────────────────────────────────────
-- finance: finance_reconciliation_items
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "finance_reconciliation_items"
  ALTER COLUMN "book_amount"   TYPE INT USING ROUND("book_amount" * 100)::INT,
  ALTER COLUMN "actual_amount" TYPE INT USING ROUND("actual_amount" * 100)::INT,
  ALTER COLUMN "difference"    TYPE INT USING ROUND("difference" * 100)::INT;

-- ─────────────────────────────────────────────────────────────────────────────
-- operations: cost_records
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "cost_records"
  ALTER COLUMN "amount" TYPE INT USING ROUND("amount" * 100)::INT;

-- ─────────────────────────────────────────────────────────────────────────────
-- operations: purchase_orders
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "purchase_orders"
  ALTER COLUMN "total_amount" TYPE INT USING ROUND("total_amount" * 100)::INT;

-- ─────────────────────────────────────────────────────────────────────────────
-- operations: purchase_order_items
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "purchase_order_items"
  ALTER COLUMN "unit_price" TYPE INT USING ROUND("unit_price" * 100)::INT,
  ALTER COLUMN "amount"     TYPE INT USING ROUND("amount" * 100)::INT;

-- ─────────────────────────────────────────────────────────────────────────────
-- operations: sale_orders
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "sale_orders"
  ALTER COLUMN "total_revenue" TYPE INT USING ROUND("total_revenue" * 100)::INT,
  ALTER COLUMN "total_profit"  TYPE INT USING ROUND("total_profit" * 100)::INT;

-- ─────────────────────────────────────────────────────────────────────────────
-- operations: sale_order_items
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "sale_order_items"
  ALTER COLUMN "sale_price" TYPE INT USING ROUND("sale_price" * 100)::INT,
  ALTER COLUMN "profit"     TYPE INT USING ROUND("profit" * 100)::INT;

-- ─────────────────────────────────────────────────────────────────────────────
-- operations: space_sessions
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "space_sessions"
  ALTER COLUMN "hourly_rate"               TYPE INT USING CASE WHEN "hourly_rate" IS NULL THEN NULL ELSE ROUND("hourly_rate" * 100)::INT END,
  ALTER COLUMN "time_cost"                 TYPE INT USING CASE WHEN "time_cost" IS NULL THEN NULL ELSE ROUND("time_cost" * 100)::INT END,
  ALTER COLUMN "prepaid_amount"            TYPE INT USING CASE WHEN "prepaid_amount" IS NULL THEN NULL ELSE ROUND("prepaid_amount" * 100)::INT END,
  ALTER COLUMN "prepaid_voucher_face_amount" TYPE INT USING CASE WHEN "prepaid_voucher_face_amount" IS NULL THEN NULL ELSE ROUND("prepaid_voucher_face_amount" * 100)::INT END,
  ALTER COLUMN "items_cost"               TYPE INT USING ROUND("items_cost" * 100)::INT;

-- ─────────────────────────────────────────────────────────────────────────────
-- staff: employees (base_salary)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "employees"
  ALTER COLUMN "base_salary" TYPE INT USING ROUND("base_salary" * 100)::INT;

-- ─────────────────────────────────────────────────────────────────────────────
-- staff: employee_leaves (deduct_amount; days 保留 Decimal)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "employee_leaves"
  ALTER COLUMN "deduct_amount" TYPE INT USING ROUND("deduct_amount" * 100)::INT;

-- ─────────────────────────────────────────────────────────────────────────────
-- staff: employee_payrolls (工资类字段改为 Int；五险一金保留 Decimal)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "employee_payrolls"
  ALTER COLUMN "base_salary"      TYPE INT USING ROUND("base_salary" * 100)::INT,
  ALTER COLUMN "leave_deduction"  TYPE INT USING ROUND("leave_deduction" * 100)::INT,
  ALTER COLUMN "other_deduction"  TYPE INT USING ROUND("other_deduction" * 100)::INT,
  ALTER COLUMN "bonus"            TYPE INT USING ROUND("bonus" * 100)::INT,
  ALTER COLUMN "actual_salary"    TYPE INT USING ROUND("actual_salary" * 100)::INT,
  ALTER COLUMN "total_labor_cost" TYPE INT USING ROUND("total_labor_cost" * 100)::INT;

-- ─────────────────────────────────────────────────────────────────────────────
-- staff: employee_payrolls (month: String → DateTime 月初零点)
-- 格式约定：原 String 格式为 "YYYY-MM"，转换为 TIMESTAMPTZ 月初 UTC 零点
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "employee_payrolls"
  ALTER COLUMN "month" TYPE TIMESTAMPTZ USING (("month"::TEXT || '-01')::DATE)::TIMESTAMPTZ;
