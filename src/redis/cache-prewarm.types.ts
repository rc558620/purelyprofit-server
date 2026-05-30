export const CACHE_PREWARM_CATEGORIES = [
  'dashboardHome',
  'businessAnalysis',
  'financeOverview',
] as const;

export type CachePrewarmCategory = (typeof CACHE_PREWARM_CATEGORIES)[number];

export type CachePrewarmDurationDistribution = {
  sampleCount: number;
  totalDurationMs: number;
  avgDurationMs: number;
  minDurationMs: number;
  maxDurationMs: number;
  p50DurationMs: number;
  p95DurationMs: number;
};

export type CachePrewarmSlowKeySample = {
  category: CachePrewarmCategory;
  cacheKey: string;
  durationMs: number;
  status: 'refreshed' | 'failed';
  errorTag: string | null;
  failedReason: string | null;
};

export type CachePrewarmCategoryResult = {
  hitCount: number;
  refreshedCount: number;
  skippedCount: number;
  invalidCount: number;
  failedCount: number;
  durationDistribution: CachePrewarmDurationDistribution;
  slowKeySamples: CachePrewarmSlowKeySample[];
};

export type CachePrewarmExecutionOptions = {
  concurrency: number;
};

export type CachePrewarmCategoryConfig = {
  category: CachePrewarmCategory;
  scanPattern: () => string;
  prewarm: (
    cacheKeys: string[],
    options: CachePrewarmExecutionOptions,
  ) => Promise<CachePrewarmCategoryResult>;
};

export type CachePrewarmCategoryResultsMap = Record<
  CachePrewarmCategory,
  CachePrewarmCategoryResult
>;

export type CachePrewarmCategoryCountMap = Record<CachePrewarmCategory, number>;

export type CachePrewarmDurationDistributionMap = Record<
  CachePrewarmCategory,
  CachePrewarmDurationDistribution
>;

export type CachePrewarmCycleMetrics = {
  durationMs: number;
  hitCount: number;
  refreshedCount: number;
  skippedCount: number;
  invalidCount: number;
  failedCount: number;
  dashboardHitCount: number;
  businessAnalysisHitCount: number;
  financeOverviewHitCount: number;
  failedKeyCountByCategory: CachePrewarmCategoryCountMap;
  slowestFailedReason: string | null;
  durationDistribution: CachePrewarmDurationDistributionMap;
  slowKeySamples: CachePrewarmSlowKeySample[];
};
