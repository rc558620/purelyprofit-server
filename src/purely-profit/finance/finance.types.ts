export const FINANCE_OVERVIEW_PERIOD_VALUES = [
  'week',
  'month',
  'quarter',
  'all',
] as const;
export type FinanceOverviewPeriodValue =
  (typeof FINANCE_OVERVIEW_PERIOD_VALUES)[number];

export const FINANCE_CASH_FLOW_DIRECTION_VALUES = [
  'income',
  'expense',
] as const;
export type FinanceCashFlowDirectionValue =
  (typeof FINANCE_CASH_FLOW_DIRECTION_VALUES)[number];

export const FINANCE_CASH_FLOW_CATEGORY_VALUES = [
  'sales',
  'refund',
  'transfer_in',
  'other_income',
  'purchase',
  'rent',
  'utilities',
  'salary',
  'marketing',
  'tax',
  'transfer_out',
  'other_expense',
] as const;
export type FinanceCashFlowCategoryValue =
  (typeof FINANCE_CASH_FLOW_CATEGORY_VALUES)[number];

export const FINANCE_CASH_FLOW_PAYMENT_VALUES = [
  'cash',
  'wechat',
  'alipay',
  'card',
  'bank',
  'other',
] as const;
export type FinanceCashFlowPaymentValue =
  (typeof FINANCE_CASH_FLOW_PAYMENT_VALUES)[number];

export const FINANCE_CASH_FLOW_DIRECTION_FILTER_VALUES = [
  'all',
  ...FINANCE_CASH_FLOW_DIRECTION_VALUES,
] as const;
export type FinanceCashFlowDirectionFilterValue =
  (typeof FINANCE_CASH_FLOW_DIRECTION_FILTER_VALUES)[number];

export const FINANCE_ACCOUNT_TYPE_VALUES = ['receivable', 'payable'] as const;
export type FinanceAccountTypeValue =
  (typeof FINANCE_ACCOUNT_TYPE_VALUES)[number];

export const FINANCE_ACCOUNT_STATUS_VALUES = [
  'pending',
  'partial',
  'settled',
  'overdue',
] as const;
export type FinanceAccountStatusValue =
  (typeof FINANCE_ACCOUNT_STATUS_VALUES)[number];

export const FINANCE_ACCOUNT_CATEGORY_VALUES = [
  'sales_credit',
  'advance_paid',
  'supplier_debt',
  'loan',
  'deposit',
  'other',
] as const;
export type FinanceAccountCategoryValue =
  (typeof FINANCE_ACCOUNT_CATEGORY_VALUES)[number];

export const FINANCE_ACCOUNT_TYPE_FILTER_VALUES = [
  'all',
  ...FINANCE_ACCOUNT_TYPE_VALUES,
] as const;
export type FinanceAccountTypeFilterValue =
  (typeof FINANCE_ACCOUNT_TYPE_FILTER_VALUES)[number];

export const FINANCE_ACCOUNT_STATUS_FILTER_VALUES = [
  'all',
  ...FINANCE_ACCOUNT_STATUS_VALUES,
] as const;
export type FinanceAccountStatusFilterValue =
  (typeof FINANCE_ACCOUNT_STATUS_FILTER_VALUES)[number];

export const FINANCE_RECONCILIATION_STATUS_VALUES = [
  'draft',
  'confirmed',
  'discrepancy',
  'adjusted',
] as const;
export type FinanceReconciliationStatusValue =
  (typeof FINANCE_RECONCILIATION_STATUS_VALUES)[number];

export const FINANCE_RECONCILIATION_TYPE_VALUES = [
  'daily',
  'weekly',
  'monthly',
  'payment',
  'supplier',
  'custom',
] as const;
export type FinanceReconciliationTypeValue =
  (typeof FINANCE_RECONCILIATION_TYPE_VALUES)[number];

export const FINANCE_PAYMENT_CHANNEL_VALUES = [
  'cash',
  'wechat',
  'alipay',
  'card',
  'bank',
  'all',
] as const;
export type FinancePaymentChannelValue =
  (typeof FINANCE_PAYMENT_CHANNEL_VALUES)[number];

export const FINANCE_RECONCILIATION_STATUS_FILTER_VALUES = [
  'all',
  ...FINANCE_RECONCILIATION_STATUS_VALUES,
] as const;
export type FinanceReconciliationStatusFilterValue =
  (typeof FINANCE_RECONCILIATION_STATUS_FILTER_VALUES)[number];

export const FINANCE_RECONCILIATION_TYPE_FILTER_VALUES = [
  'all',
  ...FINANCE_RECONCILIATION_TYPE_VALUES,
] as const;
export type FinanceReconciliationTypeFilterValue =
  (typeof FINANCE_RECONCILIATION_TYPE_FILTER_VALUES)[number];

export const FINANCE_DEFAULT_PAGE = 1;
export const FINANCE_DEFAULT_PAGE_SIZE = 20;

export const FINANCE_OVERVIEW_DISPLAY_DAYS: Record<
  FinanceOverviewPeriodValue,
  number
> = {
  week: 7,
  month: 30,
  quarter: 90,
  all: 30,
};
