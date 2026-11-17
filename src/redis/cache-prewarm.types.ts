export const CACHE_PREWARM_CATEGORIES = [
  'dashboardHome',
  'businessAnalysis',
  'financeOverview',
  'financeReport',
  'marketingOverview',
  'membersMeta',
  'membersOverview',
  'profitDetail',
  'profitReport',
  'costsStats',
  'costsReport',
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

/**
 * 单类缓存 key 的收敛策略。
 *
 * 背景：预热按 pattern 扫描后「扫到多少预热多少」，而财务报表 key 由
 * period × year × customDate × rangeStart/End × scope 组成，组合数没有上限。
 * 商家每翻一次自定义区间就多一个 key，且每个 key 都要跑多条聚合 SQL。
 * 一旦这些 key 全部留在 keyspace 里，每 15s 一轮的预热就会把全部组合反复重算，
 * 形成「key 越多 → 每轮 DB 峰值越高 → 越慢 → 下一轮越早堆积」的正反馈。
 *
 * 收敛手段（两者叠加）：
 * - `maxKeysPerStore`：单门店本轮最多预热 N 个 key，按「最近访问」优先，其余留在
 *   Redis 里等 TTL / 内存淘汰自然收敛，不再参与预热；
 * - `maxIdleSeconds`：空闲超过阈值的 key 判定为冷 key，本轮直接从 keyspace 删除，
 *   让「访问过的组合数」有界收敛，而不是只增不减。
 */
export type CachePrewarmSelectionPolicy = {
  /** 单门店本轮最多预热的 key 数 */
  maxKeysPerStore: number;
  /** 空闲超过该秒数即视为冷 key 并删除；<= 0 表示关闭空闲清理 */
  maxIdleSeconds: number;
};

export type CachePrewarmCategoryConfig = {
  category: CachePrewarmCategory;
  scanPattern: () => string;
  /**
   * 从 cacheKey 解析门店 ID，供热路径收敛按门店分组。
   * 不提供视为「不按门店收敛」，配置了 selection 也必须同时提供本函数。
   */
  resolveStoreId?: (cacheKey: string) => number | null;
  /** key 收敛策略；不提供则保持原「扫到多少预热多少」行为 */
  selection?: CachePrewarmSelectionPolicy;
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
  financeReportHitCount: number;
  marketingOverviewHitCount: number;
  membersMetaHitCount: number;
  membersOverviewHitCount: number;
  profitDetailHitCount: number;
  profitReportHitCount: number;
  costsStatsHitCount: number;
  costsReportHitCount: number;
  failedKeyCountByCategory: CachePrewarmCategoryCountMap;
  slowestFailedReason: string | null;
  durationDistribution: CachePrewarmDurationDistributionMap;
  slowKeySamples: CachePrewarmSlowKeySample[];
};
