import type { Money } from '../../../shared/money.utils';

export const BUSINESS_ANALYSIS_PERIOD_VALUES = [
  'today',
  'week',
  'month',
  'quarter',
  'year',
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

export interface BusinessAnalysisSalesSummaryRow {
  currentRevenue: number;
  currentOrderCount: number;
  previousRevenue: number;
  previousOrderCount: number;
}

export interface BusinessAnalysisDailyRevenueRow {
  bucketAt: Date;
  revenue: number;
}

export interface BusinessAnalysisCategoryRow {
  categoryName: string;
  revenue: number;
  profit: number;
  quantity: number;
}

export interface BusinessAnalysisRankRow {
  productId: number | null;
  productName: string;
  categoryName: string;
  totalRevenue: number;
  totalProfit: number;
  quantity: number;
  image: string | null;
}

export interface BusinessAnalysisCostSummaryRow {
  currentTotalCost: number;
  previousTotalCost: number;
}

export interface BusinessAnalysisDailyCostRow {
  bucketAt: Date;
  amount: number;
}

export interface BusinessAnalysisCostBucketRow {
  category: string;
  amount: number;
}

export interface AggregatedCategory {
  revenue: Money;
  profit: Money;
  quantity: number;
}

export interface AggregatedRankProduct {
  id: string;
  name: string;
  category: string;
  totalProfit: Money;
  totalRevenue: Money;
  quantity: number;
  image?: string;
}

export interface SalesAggregationResult {
  revenue: Money;
  orderCount: number;
  dailyRevenueMap: Map<number, Money>;
  categoryMap: Map<string, AggregatedCategory>;
  rankMap: Map<string, AggregatedRankProduct>;
}

export interface CostAggregationResult {
  totalCost: Money;
  dailyCostMap: Map<number, Money>;
  costBucketMap: Map<CostBucketKey, Money>;
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
