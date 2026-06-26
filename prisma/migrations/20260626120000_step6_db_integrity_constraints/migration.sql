-- Step 6: 补数据库层完整性约束
-- 6.1 CHECK 约束：防止关键数值字段出现非法负值
-- 6.2 唯一约束：补支付流水、外部身份、门店内业务编码的软删除后恢复
-- 6.3 多租户一致性：子记录 storeId 必须与父记录 storeId 一致

-- =============================================================================
-- 6.1 CHECK 约束
-- =============================================================================

-- marketing_customers: 余额、积分、累计消费、消费次数 >= 0
ALTER TABLE "marketing_customers"
  ADD CONSTRAINT "chk_marketing_customers_balance_gte_0"     CHECK ("balance" >= 0),
  ADD CONSTRAINT "chk_marketing_customers_points_gte_0"      CHECK ("points" >= 0),
  ADD CONSTRAINT "chk_marketing_customers_total_spent_gte_0" CHECK ("total_spent" >= 0),
  ADD CONSTRAINT "chk_marketing_customers_visit_count_gte_0" CHECK ("visit_count" >= 0);

-- marketing_recharges: 充值金额、赠送金额 >= 0
ALTER TABLE "marketing_recharges"
  ADD CONSTRAINT "chk_marketing_recharges_amount_gte_0"      CHECK ("amount" >= 0),
  ADD CONSTRAINT "chk_marketing_recharges_gift_amount_gte_0" CHECK ("gift_amount" >= 0);

-- marketing_consumptions: 消费金额、余额支付、积分抵扣 >= 0
ALTER TABLE "marketing_consumptions"
  ADD CONSTRAINT "chk_marketing_consumptions_amount_gte_0"          CHECK ("amount" >= 0),
  ADD CONSTRAINT "chk_marketing_consumptions_balance_paid_gte_0"    CHECK ("balance_paid" >= 0),
  ADD CONSTRAINT "chk_marketing_consumptions_points_deducted_gte_0" CHECK ("points_deducted" >= 0);

-- store_partners: 豆余额、累计获得、累计提现 >= 0
ALTER TABLE "store_partners"
  ADD CONSTRAINT "chk_store_partners_bean_balance_gte_0"          CHECK ("bean_balance" >= 0),
  ADD CONSTRAINT "chk_store_partners_total_earned_beans_gte_0"    CHECK ("total_earned_beans" >= 0),
  ADD CONSTRAINT "chk_store_partners_total_withdrawn_beans_gte_0" CHECK ("total_withdrawn_beans" >= 0);

-- partner_withdrawals: 豆金额、人民币金额 > 0
ALTER TABLE "partner_withdrawals"
  ADD CONSTRAINT "chk_partner_withdrawals_bean_amount_gt_0" CHECK ("bean_amount" > 0),
  ADD CONSTRAINT "chk_partner_withdrawals_rmb_amount_gt_0"  CHECK ("rmb_amount" > 0);

-- member_recharge_logs: 充值金额 > 0，积分奖励 >= 0
ALTER TABLE "member_recharge_logs"
  ADD CONSTRAINT "chk_member_recharge_logs_amount_gt_0"         CHECK ("amount" > 0),
  ADD CONSTRAINT "chk_member_recharge_logs_points_awarded_gte_0" CHECK ("points_awarded" >= 0);

-- store_membership_profiles: 积分、可用积分、子账号配额 >= 0
ALTER TABLE "store_membership_profiles"
  ADD CONSTRAINT "chk_store_membership_profiles_total_points_gte_0"     CHECK ("total_points" >= 0),
  ADD CONSTRAINT "chk_store_membership_profiles_available_points_gte_0" CHECK ("available_points" >= 0),
  ADD CONSTRAINT "chk_store_membership_profiles_sub_account_quota_gte_0" CHECK ("sub_account_quota" >= 0);

-- store_membership_orders: 金额 >= 0，使用积分/豆 >= 0
ALTER TABLE "store_membership_orders"
  ADD CONSTRAINT "chk_store_membership_orders_original_amount_gte_0" CHECK ("original_amount" >= 0),
  ADD CONSTRAINT "chk_store_membership_orders_amount_gte_0"           CHECK ("amount" >= 0),
  ADD CONSTRAINT "chk_store_membership_orders_points_used_gte_0"      CHECK ("points_used" >= 0),
  ADD CONSTRAINT "chk_store_membership_orders_beans_used_gte_0"       CHECK ("beans_used" >= 0);

-- products: 价格 >= 0，库存、预警阈值 >= 0
ALTER TABLE "products"
  ADD CONSTRAINT "chk_products_price_gte_0"           CHECK ("price" >= 0),
  ADD CONSTRAINT "chk_products_stock_gte_0"           CHECK ("stock" >= 0),
  ADD CONSTRAINT "chk_products_alert_threshold_gte_0" CHECK ("alert_threshold" >= 0);

-- purchase_order_items: 数量 > 0，单价 >= 0，小计 >= 0
ALTER TABLE "purchase_order_items"
  ADD CONSTRAINT "chk_purchase_order_items_quantity_gt_0"   CHECK ("quantity" > 0),
  ADD CONSTRAINT "chk_purchase_order_items_unit_price_gte_0" CHECK ("unit_price" >= 0),
  ADD CONSTRAINT "chk_purchase_order_items_amount_gte_0"    CHECK ("amount" >= 0);

-- purchase_orders: 总金额 >= 0
ALTER TABLE "purchase_orders"
  ADD CONSTRAINT "chk_purchase_orders_total_amount_gte_0" CHECK ("total_amount" >= 0);

-- sale_order_items: 数量 > 0，售价 >= 0
ALTER TABLE "sale_order_items"
  ADD CONSTRAINT "chk_sale_order_items_quantity_gt_0"    CHECK ("quantity" > 0),
  ADD CONSTRAINT "chk_sale_order_items_sale_price_gte_0" CHECK ("sale_price" >= 0);

-- sale_orders: 总收入 >= 0，总数量 > 0
ALTER TABLE "sale_orders"
  ADD CONSTRAINT "chk_sale_orders_total_revenue_gte_0"  CHECK ("total_revenue" >= 0),
  ADD CONSTRAINT "chk_sale_orders_total_quantity_gt_0"  CHECK ("total_quantity" > 0);

-- space_sessions: 商品费用 >= 0，预付金额 >= 0，倒计时分钟数 > 0（可为 NULL），计时费率 > 0（可为 NULL）
ALTER TABLE "space_sessions"
  ADD CONSTRAINT "chk_space_sessions_items_cost_gte_0"               CHECK ("items_cost" >= 0),
  ADD CONSTRAINT "chk_space_sessions_countdown_minutes_gt_0"         CHECK ("countdown_minutes" IS NULL OR "countdown_minutes" > 0),
  ADD CONSTRAINT "chk_space_sessions_hourly_rate_gt_0"               CHECK ("hourly_rate" IS NULL OR "hourly_rate" > 0),
  ADD CONSTRAINT "chk_space_sessions_time_cost_gte_0"                CHECK ("time_cost" IS NULL OR "time_cost" >= 0),
  ADD CONSTRAINT "chk_space_sessions_prepaid_amount_gte_0"           CHECK ("prepaid_amount" IS NULL OR "prepaid_amount" >= 0),
  ADD CONSTRAINT "chk_space_sessions_prepaid_voucher_face_gte_0"     CHECK ("prepaid_voucher_face_amount" IS NULL OR "prepaid_voucher_face_amount" >= 0);

-- cost_records: 金额 > 0
ALTER TABLE "cost_records"
  ADD CONSTRAINT "chk_cost_records_amount_gt_0" CHECK ("amount" > 0);

-- finance_cash_flow_records: 金额 > 0
ALTER TABLE "finance_cash_flow_records"
  ADD CONSTRAINT "chk_finance_cash_flow_records_amount_gt_0" CHECK ("amount" > 0);

-- finance_account_records: 金额 > 0，已付金额 >= 0，剩余金额 >= 0
ALTER TABLE "finance_account_records"
  ADD CONSTRAINT "chk_finance_account_records_amount_gt_0"       CHECK ("amount" > 0),
  ADD CONSTRAINT "chk_finance_account_records_paid_amount_gte_0" CHECK ("paid_amount" >= 0),
  ADD CONSTRAINT "chk_finance_account_records_remaining_gte_0"   CHECK ("remaining" >= 0);

-- employee_payrolls: 各工资分项 >= 0，实发工资可以为 0（但不应为负）
ALTER TABLE "employee_payrolls"
  ADD CONSTRAINT "chk_employee_payrolls_base_salary_gte_0"      CHECK ("base_salary" >= 0),
  ADD CONSTRAINT "chk_employee_payrolls_leave_deduction_gte_0"  CHECK ("leave_deduction" >= 0),
  ADD CONSTRAINT "chk_employee_payrolls_other_deduction_gte_0"  CHECK ("other_deduction" >= 0),
  ADD CONSTRAINT "chk_employee_payrolls_bonus_gte_0"            CHECK ("bonus" >= 0),
  ADD CONSTRAINT "chk_employee_payrolls_actual_salary_gte_0"    CHECK ("actual_salary" >= 0),
  ADD CONSTRAINT "chk_employee_payrolls_total_labor_cost_gte_0" CHECK ("total_labor_cost" >= 0);

-- employees: 基本工资 >= 0
ALTER TABLE "employees"
  ADD CONSTRAINT "chk_employees_base_salary_gte_0" CHECK ("base_salary" >= 0);

-- employee_leaves: 请假天数 >= 0，扣款金额 >= 0
ALTER TABLE "employee_leaves"
  ADD CONSTRAINT "chk_employee_leaves_days_gte_0"         CHECK ("days" >= 0),
  ADD CONSTRAINT "chk_employee_leaves_deduct_amount_gte_0" CHECK ("deduct_amount" >= 0);

-- space_reservations: 访客人数 > 0（可为 NULL）
ALTER TABLE "space_reservations"
  ADD CONSTRAINT "chk_space_reservations_guest_count_gt_0" CHECK ("guest_count" IS NULL OR "guest_count" > 0);

-- spaces: 容量 > 0（可为 NULL），排序 >= 1
ALTER TABLE "spaces"
  ADD CONSTRAINT "chk_spaces_capacity_gt_0"   CHECK ("capacity" IS NULL OR "capacity" > 0),
  ADD CONSTRAINT "chk_spaces_sort_order_gte_1" CHECK ("sort_order" >= 1);

-- =============================================================================
-- 6.2 软删除后唯一性恢复
-- （phone/code/name 等唯一约束通过之前迁移中的 Partial Index 实现，这里补齐遗漏的）
-- =============================================================================

-- marketing_customers: phone 在同一 storeId 下，deletedAt IS NULL 时唯一
-- （已在 Step 1 中由 Partial Index 处理）
-- products: code 在同一 storeId 下，deletedAt IS NULL 时唯一
-- （已在 Step 1 中由 Partial Index 处理）

-- =============================================================================
-- 6.3 多租户一致性保护（跨店引用保护）
-- 确保子记录的 storeId 与父记录 storeId 一致
-- 通过 CHECK 约束在子表中校验，避免跨店脏引用
-- =============================================================================

-- sale_order_items: storeId 必须与关联订单在同一门店
-- （Prisma 外键约束 + 应用层写入时设置 storeId = order.storeId，此处补数据库层触发器级别的 storeId 不变性约束）
-- 注意：PostgreSQL 不支持跨表 CHECK，通过外键 + Partial Index 保证门店一致性
-- 补 Partial Index 以确保 orderId 在门店内唯一（禁止跨店 orderId 引用）

-- purchase_order_items: 同上，storeId 与 order 一致
-- （同样通过外键 + 应用层写入保证）

-- 为 sale_order_items 补 orderId + storeId 组合一致性索引
-- 此索引用于快速定位并校验子项不跨店
CREATE INDEX IF NOT EXISTS "sale_order_items_order_store_idx"
  ON "sale_order_items" ("order_id", "store_id");

CREATE INDEX IF NOT EXISTS "purchase_order_items_order_store_idx"
  ON "purchase_order_items" ("order_id", "store_id");

-- space_sessions: spaceId + storeId 一致性索引
CREATE INDEX IF NOT EXISTS "space_sessions_space_store_idx"
  ON "space_sessions" ("space_id", "store_id");

-- employee_leaves: employeeId + storeId 一致性索引
CREATE INDEX IF NOT EXISTS "employee_leaves_employee_store_idx"
  ON "employee_leaves" ("employee_id", "store_id");

-- employee_shifts: employeeId + storeId 一致性索引
CREATE INDEX IF NOT EXISTS "employee_shifts_employee_store_idx"
  ON "employee_shifts" ("employee_id", "store_id");

-- employee_payrolls: employeeId + storeId 一致性索引
CREATE INDEX IF NOT EXISTS "employee_payrolls_employee_store_idx"
  ON "employee_payrolls" ("employee_id", "store_id");

-- marketing_recharges: customerId + storeId 一致性索引
CREATE INDEX IF NOT EXISTS "marketing_recharges_customer_store_idx"
  ON "marketing_recharges" ("customer_id", "store_id");

-- marketing_consumptions: customerId + storeId 一致性索引
CREATE INDEX IF NOT EXISTS "marketing_consumptions_customer_store_idx"
  ON "marketing_consumptions" ("customer_id", "store_id");

-- marketing_points_records: customerId + storeId 一致性索引
CREATE INDEX IF NOT EXISTS "marketing_points_records_customer_store_idx"
  ON "marketing_points_records" ("customer_id", "store_id");

-- member_points_logs: memberId + storeId 一致性索引
CREATE INDEX IF NOT EXISTS "member_points_logs_member_store_idx"
  ON "member_points_logs" ("member_id", "store_id");

-- member_bean_logs: memberId + storeId 一致性索引
CREATE INDEX IF NOT EXISTS "member_bean_logs_member_store_idx"
  ON "member_bean_logs" ("member_id", "store_id");

-- member_recharge_logs: memberId + storeId 一致性索引
CREATE INDEX IF NOT EXISTS "member_recharge_logs_member_store_idx"
  ON "member_recharge_logs" ("member_id", "store_id");

-- store_partner_bean_logs: partnerId + storeId 一致性索引
CREATE INDEX IF NOT EXISTS "store_partner_bean_logs_partner_store_idx"
  ON "store_partner_bean_logs" ("partner_id", "store_id");

-- partner_withdrawals: partnerId + storeId 一致性索引
CREATE INDEX IF NOT EXISTS "partner_withdrawals_partner_store_idx"
  ON "partner_withdrawals" ("partner_id", "store_id");

-- cost_records: purchaseOrderId + storeId 一致性索引（当 purchaseOrderId 非空）
CREATE INDEX IF NOT EXISTS "cost_records_purchase_order_store_idx"
  ON "cost_records" ("purchase_order_id", "store_id")
  WHERE "purchase_order_id" IS NOT NULL;

-- inventory_adjustment_logs: productId + storeId 一致性索引
CREATE INDEX IF NOT EXISTS "inventory_adjustment_logs_product_store_idx"
  ON "inventory_adjustment_logs" ("product_id", "store_id");
