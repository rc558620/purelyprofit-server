import {
  type CostCategory,
  type CostSourceType,
  type CostType,
} from '@prisma/client';
import {
  PURCHASE_PERIOD_VALUES,
  type PurchasePeriodValue,
} from '../../commerce/commerce.utils';

export const COST_PERIOD_VALUES = PURCHASE_PERIOD_VALUES;
export type CostPeriodValue = PurchasePeriodValue;

export const COST_TYPE_VALUES = [
  'fixed',
  'variable',
] as const satisfies readonly CostType[];
export const COST_TYPE_FILTER_VALUES = ['all', ...COST_TYPE_VALUES] as const;
export type CostTypeFilterValue = (typeof COST_TYPE_FILTER_VALUES)[number];

export const COST_REPORT_PERIOD_VALUES = [
  'today',
  'week',
  'month',
  'quarter',
  'year',
  'custom_month',
  'custom_range',
] as const;
export type CostReportPeriodValue = (typeof COST_REPORT_PERIOD_VALUES)[number];

export const COST_CATEGORY_VALUES = [
  'rent',
  'salary',
  'insurance',
  'provident_fund',
  'utilities',
  'purchase',
  'equipment',
  'marketing',
  'packaging',
  'other',
] as const satisfies readonly CostCategory[];

export const COST_SOURCE_TYPE_VALUES = [
  'manual',
  'purchase',
  'payroll_salary',
  'payroll_insurance',
  'payroll_provident_fund',
] as const satisfies readonly CostSourceType[];

export const COST_REPORT_CATEGORY_FILTER_VALUES = [
  'all',
  ...COST_CATEGORY_VALUES,
] as const;
export type CostReportCategoryFilterValue =
  (typeof COST_REPORT_CATEGORY_FILTER_VALUES)[number];

export const COST_CATEGORY_META: Record<
  CostCategory,
  { label: string; color: string }
> = {
  rent: { label: '租金', color: '#6366f1' },
  salary: { label: '工资', color: '#f97316' },
  insurance: { label: '社保', color: '#ec4899' },
  provident_fund: { label: '公积金', color: '#8b5cf6' },
  utilities: { label: '水电费', color: '#06b6d4' },
  purchase: { label: '进货', color: '#84cc16' },
  equipment: { label: '设备', color: '#a855f7' },
  marketing: { label: '营销', color: '#3b82f6' },
  packaging: { label: '耗材', color: '#10b981' },
  other: { label: '其他', color: '#94a3b8' },
};
