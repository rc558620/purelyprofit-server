import type { CostCategory } from '@prisma/client';

export const PROFIT_DETAIL_PERIOD_VALUES = [
  'today',
  'week',
  'month',
  'quarter',
  'year',
  'custom_month',
  'custom_range',
] as const;

export type ProfitDetailPeriodValue =
  (typeof PROFIT_DETAIL_PERIOD_VALUES)[number];

export const PROFIT_DETAIL_COST_META: Record<
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
