import { Prisma } from '@prisma/client';

export const BUSINESS_ANALYSIS_PERIOD_VALUES = [
  'today',
  'week',
  'month',
  'quarter',
  'year',
  'custom_month',
  'custom_range',
] as const;

export type BusinessAnalysisPeriod =
  (typeof BUSINESS_ANALYSIS_PERIOD_VALUES)[number];

export const BUSINESS_ANALYSIS_COST_CATEGORY_META = {
  purchase: { label: '进货成本', color: '#f97316' },
  salary: { label: '人力成本', color: '#3b82f6' },
  rent: { label: '租金', color: '#8b5cf6' },
  utilities: { label: '水电费', color: '#06b6d4' },
  marketing: { label: '营销', color: '#ec4899' },
  other: { label: '其他', color: '#94a3b8' },
} as const;

export type CostBucketKey = keyof typeof BUSINESS_ANALYSIS_COST_CATEGORY_META;

export const BUSINESS_ANALYSIS_SALE_ORDER_ITEM_SELECT =
  Prisma.validator<Prisma.SaleOrderItemSelect>()({
    productId: true,
    productName: true,
    categoryName: true,
    salePrice: true,
    profit: true,
    quantity: true,
    image: true,
    createdAt: true,
    order: {
      select: {
        id: true,
        date: true,
      },
    },
  });

export type SaleOrderItemRow = Prisma.SaleOrderItemGetPayload<{
  select: typeof BUSINESS_ANALYSIS_SALE_ORDER_ITEM_SELECT;
}>;

export const BUSINESS_ANALYSIS_COST_RECORD_SELECT =
  Prisma.validator<Prisma.CostRecordSelect>()({
    category: true,
    amount: true,
    date: true,
  });

export type CostRecordCostRow = Prisma.CostRecordGetPayload<{
  select: typeof BUSINESS_ANALYSIS_COST_RECORD_SELECT;
}>;

export interface BusinessAnalysisSalesSummaryRow {
  currentRevenue: Prisma.Decimal | null;
  currentOrderCount: number;
  previousRevenue: Prisma.Decimal | null;
  previousOrderCount: number;
}

export interface BusinessAnalysisDailyRevenueRow {
  bucketAt: Date;
  revenue: Prisma.Decimal | null;
}

export interface BusinessAnalysisCategoryRow {
  categoryName: string;
  revenue: Prisma.Decimal | null;
  profit: Prisma.Decimal | null;
  quantity: number;
}

export interface BusinessAnalysisRankRow {
  productId: number | null;
  productName: string;
  categoryName: string;
  totalRevenue: Prisma.Decimal | null;
  totalProfit: Prisma.Decimal | null;
  quantity: number;
  image: string | null;
}

export interface BusinessAnalysisCostSummaryRow {
  currentTotalCost: Prisma.Decimal | null;
  previousTotalCost: Prisma.Decimal | null;
}

export interface BusinessAnalysisDailyCostRow {
  bucketAt: Date;
  amount: Prisma.Decimal | null;
}

export interface BusinessAnalysisCostBucketRow {
  category: string;
  amount: Prisma.Decimal | null;
}

export interface AggregatedCategory {
  revenue: number;
  profit: number;
  quantity: number;
}

export interface AggregatedRankProduct {
  id: string;
  name: string;
  category: string;
  totalProfit: number;
  totalRevenue: number;
  quantity: number;
  image?: string;
}

export interface SalesAggregationResult {
  revenue: number;
  orderCount: number;
  dailyRevenueMap: Map<number, number>;
  categoryMap: Map<string, AggregatedCategory>;
  rankMap: Map<string, AggregatedRankProduct>;
}

export interface CostAggregationResult {
  totalCost: number;
  dailyCostMap: Map<number, number>;
  costBucketMap: Map<CostBucketKey, number>;
}

export interface BusinessAnalysisRange {
  start: number;
  end: number;
}

export interface BusinessAnalysisAccessibleRange extends BusinessAnalysisRange {
  clamped: boolean;
  empty: boolean;
}

export interface BusinessAnalysisRangeQuery {
  period: BusinessAnalysisPeriod;
  startTime?: number;
  endTime?: number;
}

export interface BusinessAnalysisMetricsSnapshot {
  currentRange: BusinessAnalysisAccessibleRange;
  currentSales: SalesAggregationResult;
  previousSales: SalesAggregationResult;
  currentCosts: CostAggregationResult;
  previousCosts: CostAggregationResult;
}
