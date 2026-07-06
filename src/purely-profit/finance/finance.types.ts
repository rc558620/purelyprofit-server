import type { FinanceAccountStatus, Prisma } from '@prisma/client';

export const FINANCE_OVERVIEW_PERIOD_VALUES = [
  'today',
  'week',
  'month',
  'quarter',
  'year',
] as const;
export type FinanceOverviewPeriodValue =
  (typeof FINANCE_OVERVIEW_PERIOD_VALUES)[number];

export const FINANCE_REPORT_PERIOD_VALUES = [
  'today',
  'week',
  'month',
  'quarter',
  'year',
  'custom_month',
  'custom_range',
] as const;
export type FinanceReportPeriodValue =
  (typeof FINANCE_REPORT_PERIOD_VALUES)[number];

export const FINANCE_CASH_FLOW_DIRECTION_VALUES = [
  'income',
  'expense',
] as const;
export type FinanceCashFlowDirectionValue =
  (typeof FINANCE_CASH_FLOW_DIRECTION_VALUES)[number];

export const FINANCE_CASH_FLOW_CATEGORY_VALUES = [
  'sales',
  'platform_settlement',
  'refund',
  'transfer_in',
  'other_income',
  'purchase',
  'rent',
  'utilities',
  'salary',
  'marketing',
  'tax',
  'platform_fee',
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
  'meituan',
  'douyin',
  'platform',
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

export const FINANCE_CASH_FLOW_PERIOD_VALUES = [
  'today',
  'week',
  'month',
  'quarter',
  'year',
  'custom_day',
  'custom_range',
] as const;
export type FinanceCashFlowPeriodValue =
  (typeof FINANCE_CASH_FLOW_PERIOD_VALUES)[number];

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
  today: 1,
  week: 7,
  month: 30,
  quarter: 90,
  year: 365,
};

export interface PaginationState {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface FinanceReportQueryInput {
  period?: FinanceReportPeriodValue;
  year?: number;
  customDate?: number;
  rangeStartDate?: number;
  rangeEndDate?: number;
  export?: boolean;
}

export interface FinanceCashFlowListQueryInput {
  period?: FinanceCashFlowPeriodValue;
  directionFilter?: FinanceCashFlowDirectionFilterValue;
  customDayYear?: number;
  customDayMonth?: number;
  customDayDay?: number;
  customRangeStartYear?: number;
  customRangeStartMonth?: number;
  customRangeStartDay?: number;
  customRangeEndYear?: number;
  customRangeEndMonth?: number;
  customRangeEndDay?: number;
  page?: number;
  pageSize?: number;
}

export interface FinanceAccountsListQueryInput {
  typeFilter?: FinanceAccountTypeFilterValue;
  statusFilter?: FinanceAccountStatusFilterValue;
  searchText?: string;
  page?: number;
  pageSize?: number;
}

export interface FinanceReconciliationsListQueryInput {
  statusFilter?: FinanceReconciliationStatusFilterValue;
  typeFilter?: FinanceReconciliationTypeFilterValue;
  searchText?: string;
  page?: number;
  pageSize?: number;
}

export interface FinanceReportRange {
  start: number;
  end: number;
  period: FinanceReportPeriodValue;
}

export interface FinanceCashFlowFilterRange {
  start: number;
  end: number;
  period: FinanceCashFlowPeriodValue;
}

export interface FinanceReconciliationItemInput {
  description: string;
  bookAmount: number;
  actualAmount: number;
  note?: string | null;
}

export interface FinanceCashFlowRecordWithAmount {
  id: number;
  direction: string;
  category: string;
  title: string;
  amount: number; // Step 3: 改为 Int（分）
  payment: string;
  note: string | null;
  date: Date;
  createdAt: Date;
}

export interface FinanceCashFlowStatsRow {
  direction: string;
  amount: number; // Step 3: 改为 Int（分）
}

export interface FinanceAccountRecordWithAmount {
  id: number;
  type: string;
  category: string;
  counterpart: string;
  amount: number; // Step 3: 改为 Int（分）
  paidAmount: number; // Step 3: 改为 Int（分）
  remaining: number; // Step 3: 改为 Int（分）
  status: FinanceAccountStatus;
  dueDate: Date | null;
  date: Date;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FinanceDerivedAccountFields {
  remaining: number;
  status: FinanceAccountStatus;
}

export type FinanceReconciliationRecordWithItems =
  Prisma.FinanceReconciliationRecordGetPayload<{
    include: { items: true };
  }>;
