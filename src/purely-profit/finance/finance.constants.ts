import { FinanceAccountStatus } from '@prisma/client';
import { Money } from '../../shared/money.utils';
import type {
  FinanceAccountCategoryValue,
  FinanceAccountTypeValue,
  FinanceCashFlowCategoryValue,
  FinanceCashFlowDirectionValue,
} from './finance.types';

export const DAY_MS = 86_400_000;

export const ACCOUNT_STATUS_ORDER: Record<FinanceAccountStatus, number> = {
  overdue: 0,
  pending: 1,
  partial: 2,
  settled: 3,
};

export const OVERVIEW_SOURCE_CONFIG = {
  sales: {
    label: '销售收入',
    direction: 'income' as const,
    color: '#84cc16',
    icon: '🛒',
  },
  additional: {
    label: '附加收入',
    direction: 'income' as const,
    color: '#10b981',
    icon: '✨',
  },
  cost: {
    label: '成本支出',
    direction: 'expense' as const,
    color: '#f43f5e',
    icon: '📋',
  },
  purchase: {
    label: '进货支出',
    direction: 'expense' as const,
    color: '#f97316',
    icon: '🚚',
  },
} as const;

export type FinanceCashFlowOverviewBucket = keyof typeof OVERVIEW_SOURCE_CONFIG;
export type FinancePeriodTotals = Record<FinanceCashFlowOverviewBucket, Money>;

export type FinanceCashFlowCategoryRule = {
  label: string;
  direction: FinanceCashFlowDirectionValue;
  allowManualCreate: boolean;
  overviewBucket: FinanceCashFlowOverviewBucket;
  manualCreateError?: string;
};

export type FinanceAccountCategoryRule = {
  label: string;
  allowManualCreate: boolean;
  allowedTypes: FinanceAccountTypeValue[];
  manualCreateError?: string;
};

export const CASH_FLOW_CATEGORY_RULES = {
  sales: {
    label: '销售收入',
    direction: 'income',
    allowManualCreate: false,
    overviewBucket: 'sales',
    manualCreateError: '销售收入流水需通过销售记录自动生成',
  },
  refund: {
    label: '退款回收',
    direction: 'income',
    allowManualCreate: true,
    overviewBucket: 'additional',
  },
  transfer_in: {
    label: '转账收入',
    direction: 'income',
    allowManualCreate: true,
    overviewBucket: 'additional',
  },
  other_income: {
    label: '其他收入',
    direction: 'income',
    allowManualCreate: true,
    overviewBucket: 'additional',
  },
  purchase: {
    label: '采购进货',
    direction: 'expense',
    allowManualCreate: true,
    overviewBucket: 'purchase',
  },
  rent: {
    label: '店面租金',
    direction: 'expense',
    allowManualCreate: true,
    overviewBucket: 'cost',
  },
  utilities: {
    label: '水电煤气',
    direction: 'expense',
    allowManualCreate: true,
    overviewBucket: 'cost',
  },
  salary: {
    label: '员工工资',
    direction: 'expense',
    allowManualCreate: true,
    overviewBucket: 'cost',
  },
  marketing: {
    label: '营销推广',
    direction: 'expense',
    allowManualCreate: true,
    overviewBucket: 'cost',
  },
  tax: {
    label: '税务缴纳',
    direction: 'expense',
    allowManualCreate: true,
    overviewBucket: 'cost',
  },
  transfer_out: {
    label: '转账支出',
    direction: 'expense',
    allowManualCreate: true,
    overviewBucket: 'cost',
  },
  other_expense: {
    label: '其他支出',
    direction: 'expense',
    allowManualCreate: true,
    overviewBucket: 'cost',
  },
} as const satisfies Record<
  FinanceCashFlowCategoryValue,
  FinanceCashFlowCategoryRule
>;

export const ACCOUNT_CATEGORY_RULES = {
  sales_credit: {
    label: '客户赊账',
    allowManualCreate: true,
    allowedTypes: ['receivable'],
  },
  advance_paid: {
    label: '预付货款',
    allowManualCreate: true,
    allowedTypes: ['receivable', 'payable'],
  },
  supplier_debt: {
    label: '供应商欠款',
    allowManualCreate: true,
    allowedTypes: ['payable'],
  },
  loan: {
    label: '借贷往来',
    allowManualCreate: true,
    allowedTypes: ['receivable', 'payable'],
  },
  deposit: {
    label: '押金/保证金',
    allowManualCreate: true,
    allowedTypes: ['receivable', 'payable'],
  },
  other: {
    label: '其他',
    allowManualCreate: true,
    allowedTypes: ['receivable', 'payable'],
  },
} as const satisfies Record<
  FinanceAccountCategoryValue,
  FinanceAccountCategoryRule
>;

export const FINANCE_REPORT_PAYMENT_LABELS: Record<string, string> = {
  cash: '现金',
  wechat: '微信',
  alipay: '支付宝',
  card: '刷卡',
  bank: '银行转账',
  other: '其他',
};

export const FINANCE_REPORT_ACCOUNT_STATUS_LABELS: Record<string, string> = {
  pending: '待收付',
  partial: '部分收付',
  settled: '已结清',
  overdue: '已逾期',
};

export const FINANCE_REPORT_ACCOUNT_TYPE_LABELS: Record<string, string> = {
  receivable: '应收',
  payable: '应付',
};
