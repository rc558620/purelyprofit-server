import { Money } from '../../shared/money.utils';
import type {
  FinanceAccountCategoryValue,
  FinanceAccountTypeValue,
  FinanceCashFlowCategoryValue,
  FinanceCashFlowDirectionValue,
} from './finance.types';

export const DAY_MS = 86_400_000;

/**
 * 财务域缓存策略（唯一事实来源）。
 *
 * 此前列表 / 统计 / 概览 / 报表四个服务各自定义一份 TTL 与刷新阈值，
 * 调整口径要改四处，极易出现「同一个页面的列表与统计缓存寿命不一致」。
 */
export const FINANCE_LIST_CACHE_TTL_SECONDS = 60;
export const FINANCE_LIST_REFRESH_AFTER_MS = 15_000;
export const FINANCE_OVERVIEW_CACHE_TTL_SECONDS = 120;
export const FINANCE_OVERVIEW_REFRESH_AFTER_MS = 30_000;
export const FINANCE_REPORT_CACHE_TTL_SECONDS = 120;
export const FINANCE_REPORT_REFRESH_AFTER_MS = 30_000;

/**
 * 报表「明细行」缓存（与 summary 拆成两个 key）。
 *
 * 为什么要拆：一个 key 同时装 summary + 最多 5000 条流水行 + 200 条账款行时，
 * 单 key 体积约 940 KB（实测：流水 5000 行 895 KB、账款 200 行 41 KB）。
 * 每次 summary 刷新都要把这 940 KB 重新序列化、整体 GET/SET 一次，
 * 且明细行（变动快）与概况（聚合结果）被迫共用同一个 TTL。
 *
 * 拆分后：
 * - summary 保持 120s/30s，只装 7 个数字；
 * - 明细行用更短 TTL，新增流水更快出现在表格里，且不再拖累 summary。
 *
 * 一致性边界：两个 part 的失效是按 pattern 一起清的（任何财务写操作都会清
 * `profit:finance:report:store:<id>:*`），因此正常情况下二者同步重建；
 * 只有当写入方绕过缓存失效时，才可能出现「明细已更新、概况仍是旧值」的窗口，
 * 上限为 summary 的 TTL，且最迟在 refreshAfterMs 之后由后台刷新自愈。
 */
export const FINANCE_REPORT_ROWS_CACHE_TTL_SECONDS = 30;
export const FINANCE_REPORT_ROWS_REFRESH_AFTER_MS = 10_000;

/**
 * 报表 CSV 导出的单批拉取行数。
 *
 * 导出不再受固定行数上限约束：按主排序键做 keyset 分批，任意时刻内存里只有一批；
 * 该值兼顾「单次 SQL 往返成本」与「单批内存占用」。
 */
export const FINANCE_REPORT_EXPORT_BATCH_SIZE = 500;

/**
 * 财务报表「未结清账款」明细行上限。
 *
 * 明细行只用于渲染表格 / 打印 / 导出，金额汇总改由 SQL 聚合产出，
 * 因此截断不再影响 `receivableTotal` / `payableTotal`（此前 5000 条上限会让
 * 未结清超过 5000 条的门店金额被低估 90%+）。
 *
 * 取值依据（诊断库单店 66,220 条未结清实测）：
 * 100 行 1.31 ms / 20 KB、200 行 1.64 ms / 41 KB、500 行 3.44 ms / 101 KB；
 * 前端 DetailCard 一次性渲染全部行、无虚拟滚动，200 行是载荷与覆盖率之间的拐点。
 */
export const FINANCE_REPORT_ACCOUNT_ROW_LIMIT = 200;

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
  platform_settlement: {
    label: '平台到账',
    direction: 'income',
    allowManualCreate: true,
    overviewBucket: 'additional',
  },
  refund: {
    label: '退款支出',
    direction: 'expense',
    allowManualCreate: false,
    overviewBucket: 'cost',
    manualCreateError: '退款流水需通过销售退款自动生成',
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
  platform_fee: {
    label: '平台手续费',
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
  meituan: '美团',
  douyin: '抖音',
  platform: '团购',
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
