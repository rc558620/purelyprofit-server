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

/** 商品利润排行支持的排序维度（由前端透传，服务端按维度排序并截断）。 */
export const BUSINESS_ANALYSIS_RANK_SORT_VALUES = [
  'profit',
  'revenue',
  'quantity',
] as const;

export type BusinessAnalysisRankSort =
  (typeof BUSINESS_ANALYSIS_RANK_SORT_VALUES)[number];

export const DEFAULT_BUSINESS_ANALYSIS_RANK_SORT: BusinessAnalysisRankSort =
  'profit';

/**
 * 商品排行榜返回条数上限。
 * 排行在服务端按 rankSort 排序后截断：页面只展示 Top5，CSV 导出最多导出该条数。
 * 若不截断，长周期下会返回店内全部历史商品行，聚合与传输成本随 SKU 数线性增长。
 */
export const BUSINESS_ANALYSIS_RANK_LIMIT = 100;

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
  /** 当前周期商品利润总和（已扣除商品成本价） */
  currentProfit: number;
  /** 上期商品利润总和（已扣除商品成本价） */
  previousProfit: number;
}

export interface BusinessAnalysisDailyRevenueRow {
  bucketAt: Date;
  revenue: number;
  /** 当日商品利润总和（已扣除商品成本价） */
  profit: number;
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
  /** 商品利润总和 = Σ(单件利润 × 数量)，已扣除商品成本价 */
  totalProfit: Money;
  /** 商品销售成本 = Σ((售价 − 利润) × 数量) */
  goodsCost: Money;
  orderCount: number;
  dailyRevenueMap: Map<number, Money>;
  /** 按天聚合的商品利润（已扣除商品成本价） */
  dailyProfitMap: Map<number, Money>;
  /** 按天聚合的商品销售成本 */
  dailyGoodsCostMap: Map<number, Money>;
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
