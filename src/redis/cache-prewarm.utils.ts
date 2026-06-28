import type {
  CachePrewarmCategory,
  CachePrewarmCategoryResult,
  CachePrewarmCategoryResultsMap,
  CachePrewarmCycleMetrics,
  CachePrewarmDurationDistribution,
  CachePrewarmSlowKeySample,
} from './cache-prewarm.types';
import { CACHE_PREWARM_CATEGORIES } from './cache-prewarm.types';

export const MAX_CACHE_PREWARM_SLOW_KEY_SAMPLES = 5;

function getPercentile(durations: number[], percentile: number): number {
  if (durations.length === 0) {
    return 0;
  }

  const sortedDurations = [...durations].sort((left, right) => left - right);
  const index = Math.min(
    sortedDurations.length - 1,
    Math.max(0, Math.ceil(sortedDurations.length * percentile) - 1),
  );

  return sortedDurations[index] ?? 0;
}

export function buildCachePrewarmDurationDistribution(
  durations: number[],
): CachePrewarmDurationDistribution {
  if (durations.length === 0) {
    return {
      sampleCount: 0,
      totalDurationMs: 0,
      avgDurationMs: 0,
      minDurationMs: 0,
      maxDurationMs: 0,
      p50DurationMs: 0,
      p95DurationMs: 0,
    };
  }

  const totalDurationMs = durations.reduce(
    (sum, duration) => sum + duration,
    0,
  );

  return {
    sampleCount: durations.length,
    totalDurationMs,
    avgDurationMs: totalDurationMs / durations.length,
    minDurationMs: Math.min(...durations),
    maxDurationMs: Math.max(...durations),
    p50DurationMs: getPercentile(durations, 0.5),
    p95DurationMs: getPercentile(durations, 0.95),
  };
}

export function buildEmptyCachePrewarmCategoryResult(
  hitCount = 0,
): CachePrewarmCategoryResult {
  return {
    hitCount,
    refreshedCount: 0,
    skippedCount: 0,
    invalidCount: 0,
    failedCount: 0,
    durationDistribution: buildCachePrewarmDurationDistribution([]),
    slowKeySamples: [],
  };
}

export function selectTopSlowCachePrewarmSamples(
  samples: CachePrewarmSlowKeySample[],
): CachePrewarmSlowKeySample[] {
  return [...samples]
    .sort((left, right) => right.durationMs - left.durationMs)
    .slice(0, MAX_CACHE_PREWARM_SLOW_KEY_SAMPLES);
}

export function buildCachePrewarmCategoryResultsMap(
  entries: ReadonlyArray<
    readonly [CachePrewarmCategory, CachePrewarmCategoryResult]
  >,
): CachePrewarmCategoryResultsMap {
  const results: CachePrewarmCategoryResultsMap = {
    dashboardHome: buildEmptyCachePrewarmCategoryResult(),
    businessAnalysis: buildEmptyCachePrewarmCategoryResult(),
    financeOverview: buildEmptyCachePrewarmCategoryResult(),
    financeReport: buildEmptyCachePrewarmCategoryResult(),
    marketingOverview: buildEmptyCachePrewarmCategoryResult(),
    membersMeta: buildEmptyCachePrewarmCategoryResult(),
    membersOverview: buildEmptyCachePrewarmCategoryResult(),
    profitDetail: buildEmptyCachePrewarmCategoryResult(),
    profitReport: buildEmptyCachePrewarmCategoryResult(),
    costsStats: buildEmptyCachePrewarmCategoryResult(),
    costsReport: buildEmptyCachePrewarmCategoryResult(),
  };

  for (const [category, result] of entries) {
    results[category] = result;
  }

  return results;
}

export function buildCachePrewarmCycleMetrics(
  durationMs: number,
  results: CachePrewarmCategoryResultsMap,
): CachePrewarmCycleMetrics {
  const slowKeySamples = selectTopSlowCachePrewarmSamples(
    CACHE_PREWARM_CATEGORIES.flatMap(
      (category) => results[category].slowKeySamples,
    ),
  );
  const slowestFailedSample = slowKeySamples.find(
    (sample) => sample.status === 'failed',
  );

  return {
    durationMs,
    hitCount: CACHE_PREWARM_CATEGORIES.reduce(
      (sum, category) => sum + results[category].hitCount,
      0,
    ),
    refreshedCount: CACHE_PREWARM_CATEGORIES.reduce(
      (sum, category) => sum + results[category].refreshedCount,
      0,
    ),
    skippedCount: CACHE_PREWARM_CATEGORIES.reduce(
      (sum, category) => sum + results[category].skippedCount,
      0,
    ),
    invalidCount: CACHE_PREWARM_CATEGORIES.reduce(
      (sum, category) => sum + results[category].invalidCount,
      0,
    ),
    failedCount: CACHE_PREWARM_CATEGORIES.reduce(
      (sum, category) => sum + results[category].failedCount,
      0,
    ),
    dashboardHitCount: results.dashboardHome.hitCount,
    businessAnalysisHitCount: results.businessAnalysis.hitCount,
    financeOverviewHitCount: results.financeOverview.hitCount,
    financeReportHitCount: results.financeReport.hitCount,
    marketingOverviewHitCount: results.marketingOverview.hitCount,
    membersMetaHitCount: results.membersMeta.hitCount,
    membersOverviewHitCount: results.membersOverview.hitCount,
    profitDetailHitCount: results.profitDetail.hitCount,
    profitReportHitCount: results.profitReport.hitCount,
    costsStatsHitCount: results.costsStats.hitCount,
    costsReportHitCount: results.costsReport.hitCount,
    failedKeyCountByCategory: {
      dashboardHome: results.dashboardHome.failedCount,
      businessAnalysis: results.businessAnalysis.failedCount,
      financeOverview: results.financeOverview.failedCount,
      financeReport: results.financeReport.failedCount,
      marketingOverview: results.marketingOverview.failedCount,
      membersMeta: results.membersMeta.failedCount,
      membersOverview: results.membersOverview.failedCount,
      profitDetail: results.profitDetail.failedCount,
      profitReport: results.profitReport.failedCount,
      costsStats: results.costsStats.failedCount,
      costsReport: results.costsReport.failedCount,
    },
    slowestFailedReason: slowestFailedSample
      ? `${slowestFailedSample.errorTag}:${slowestFailedSample.failedReason}`
      : null,
    durationDistribution: {
      dashboardHome: results.dashboardHome.durationDistribution,
      businessAnalysis: results.businessAnalysis.durationDistribution,
      financeOverview: results.financeOverview.durationDistribution,
      financeReport: results.financeReport.durationDistribution,
      marketingOverview: results.marketingOverview.durationDistribution,
      membersMeta: results.membersMeta.durationDistribution,
      membersOverview: results.membersOverview.durationDistribution,
      profitDetail: results.profitDetail.durationDistribution,
      profitReport: results.profitReport.durationDistribution,
      costsStats: results.costsStats.durationDistribution,
      costsReport: results.costsReport.durationDistribution,
    },
    slowKeySamples,
  };
}

export function buildFailedCachePrewarmCycleMetrics(
  durationMs: number,
): CachePrewarmCycleMetrics {
  return {
    durationMs,
    hitCount: 0,
    refreshedCount: 0,
    skippedCount: 0,
    invalidCount: 0,
    failedCount: 1,
    dashboardHitCount: 0,
    businessAnalysisHitCount: 0,
    financeOverviewHitCount: 0,
    financeReportHitCount: 0,
    marketingOverviewHitCount: 0,
    membersMetaHitCount: 0,
    membersOverviewHitCount: 0,
    profitDetailHitCount: 0,
    profitReportHitCount: 0,
    costsStatsHitCount: 0,
    costsReportHitCount: 0,
    failedKeyCountByCategory: {
      dashboardHome: 0,
      businessAnalysis: 0,
      financeOverview: 0,
      financeReport: 0,
      marketingOverview: 0,
      membersMeta: 0,
      membersOverview: 0,
      profitDetail: 0,
      profitReport: 0,
      costsStats: 0,
      costsReport: 0,
    },
    slowestFailedReason: null,
    durationDistribution: {
      dashboardHome: buildCachePrewarmDurationDistribution([]),
      businessAnalysis: buildCachePrewarmDurationDistribution([]),
      financeOverview: buildCachePrewarmDurationDistribution([]),
      financeReport: buildCachePrewarmDurationDistribution([]),
      marketingOverview: buildCachePrewarmDurationDistribution([]),
      membersMeta: buildCachePrewarmDurationDistribution([]),
      membersOverview: buildCachePrewarmDurationDistribution([]),
      profitDetail: buildCachePrewarmDurationDistribution([]),
      profitReport: buildCachePrewarmDurationDistribution([]),
      costsStats: buildCachePrewarmDurationDistribution([]),
      costsReport: buildCachePrewarmDurationDistribution([]),
    },
    slowKeySamples: [],
  };
}
