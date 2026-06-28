import { Prisma, type CostCategory } from '@prisma/client';
import type { Money } from '../../../shared/money.utils';

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

export interface ProfitDetailQueryInput {
  storeId?: number;
  period?: ProfitDetailPeriodValue;
  year?: number;
  customDate?: number;
  rangeStartDate?: number;
  rangeEndDate?: number;
  startTime?: number;
  endTime?: number;
}

export interface ProfitDateRange {
  start: number;
  end: number;
}

export interface ProfitAccessibleRange extends ProfitDateRange {
  clamped: boolean;
  empty: boolean;
}

export const PROFIT_DETAIL_SALE_ORDER_ITEM_SELECT =
  Prisma.validator<Prisma.SaleOrderItemSelect>()({
    productId: true,
    productName: true,
    categoryName: true,
    salePrice: true,
    profit: true,
    quantity: true,
    image: true,
    order: {
      select: {
        id: true,
        date: true,
        spaceSession: {
          select: {
            space: {
              select: {
                name: true,
              },
            },
          },
        },
      },
    },
  });

export type SaleOrderItemRow = Prisma.SaleOrderItemGetPayload<{
  select: typeof PROFIT_DETAIL_SALE_ORDER_ITEM_SELECT;
}>;

export const PROFIT_DETAIL_COST_RECORD_SELECT =
  Prisma.validator<Prisma.CostRecordSelect>()({
    category: true,
    amount: true,
    date: true,
  });

export type CostRecordRow = Prisma.CostRecordGetPayload<{
  select: typeof PROFIT_DETAIL_COST_RECORD_SELECT;
}>;

export interface AggregatedRankProduct {
  id: string;
  name: string;
  category: string;
  price: Money;
  profitPerUnit: Money;
  quantity: number;
  totalProfit: Money;
  totalRevenue: Money;
  image?: string;
}

export interface SalesAggregationResult {
  revenue: Money;
  orderCount: number;
  dailyRevenueMap: Map<number, Money>;
  rankMap: Map<string, AggregatedRankProduct>;
}

export interface CostAggregationResult {
  totalCost: Money;
  dailyCostMap: Map<number, Money>;
  categoryCostMap: Map<CostCategory, Money>;
}

export interface ProfitMetricsSnapshot {
  currentRange: ProfitAccessibleRange;
  currentSales: SalesAggregationResult;
  previousSales: SalesAggregationResult;
  currentCosts: CostAggregationResult;
  previousCosts: CostAggregationResult;
  netProfit: Money;
  previousNetProfit: Money;
}

export interface ProfitClampedRanges {
  currentRange: ProfitAccessibleRange;
  previousRange: ProfitAccessibleRange;
}
