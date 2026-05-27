import type {
  CachePrewarmCategory,
  CachePrewarmCycleMetrics,
} from './cache-prewarm.types';

export function buildCachePrewarmFailedLogPayload(input: {
  category: CachePrewarmCategory;
  cacheKey: string;
  durationMs: number;
  errorTag: string;
  failedReason: string;
}): {
  durationMs: number;
  category: CachePrewarmCategory;
  cacheKey: string;
  status: 'failed';
  errorTag: string;
  failedReason: string;
} {
  return {
    durationMs: input.durationMs,
    category: input.category,
    cacheKey: input.cacheKey,
    status: 'failed',
    errorTag: input.errorTag,
    failedReason: input.failedReason,
  };
}

export function shouldLogCachePrewarmCycleSummary(
  cycleId: number,
  metrics: CachePrewarmCycleMetrics,
  logSampleEvery: number,
  slowCycleThresholdMs: number,
): boolean {
  const shouldSample = cycleId % logSampleEvery === 0;
  const isSlowCycle = metrics.durationMs >= slowCycleThresholdMs;
  const hasAnomaly =
    metrics.failedCount > 0 ||
    metrics.invalidCount > 0 ||
    metrics.skippedCount > 0;

  return shouldSample || isSlowCycle || hasAnomaly;
}

export function buildCachePrewarmCycleSummaryLog(
  cycleId: number,
  metrics: CachePrewarmCycleMetrics,
): string {
  const slowestKeySample = metrics.slowKeySamples[0];
  const slowestFailedSample = metrics.slowKeySamples.find(
    (sample) => sample.status === 'failed',
  );

  return [
    '[cache-prewarm] cycle',
    `id=${cycleId}`,
    `durationMs=${metrics.durationMs}`,
    `hits=${metrics.hitCount}`,
    `refreshed=${metrics.refreshedCount}`,
    `skipped=${metrics.skippedCount}`,
    `invalid=${metrics.invalidCount}`,
    `failed=${metrics.failedCount}`,
    `dashboard=${metrics.dashboardHitCount}`,
    `analysis=${metrics.businessAnalysisHitCount}`,
    `finance=${metrics.financeOverviewHitCount}`,
    `failedKeyCountByCategory=dashboardHome:${metrics.failedKeyCountByCategory.dashboardHome},businessAnalysis:${metrics.failedKeyCountByCategory.businessAnalysis},financeOverview:${metrics.failedKeyCountByCategory.financeOverview}`,
    `dashboardAvgMs=${metrics.durationDistribution.dashboardHome.avgDurationMs.toFixed(2)}`,
    `dashboardP95Ms=${metrics.durationDistribution.dashboardHome.p95DurationMs.toFixed(2)}`,
    `analysisAvgMs=${metrics.durationDistribution.businessAnalysis.avgDurationMs.toFixed(2)}`,
    `analysisP95Ms=${metrics.durationDistribution.businessAnalysis.p95DurationMs.toFixed(2)}`,
    `financeAvgMs=${metrics.durationDistribution.financeOverview.avgDurationMs.toFixed(2)}`,
    `financeP95Ms=${metrics.durationDistribution.financeOverview.p95DurationMs.toFixed(2)}`,
    slowestKeySample
      ? `slowestKey=${slowestKeySample.category}:${slowestKeySample.cacheKey}`
      : 'slowestKey=none',
    slowestKeySample
      ? `slowestKeyMs=${slowestKeySample.durationMs.toFixed(2)}`
      : 'slowestKeyMs=0.00',
    slowestFailedSample
      ? `slowestFailedErrorTag=${slowestFailedSample.errorTag}`
      : 'slowestFailedErrorTag=none',
    slowestFailedSample
      ? `slowestFailedReason=${slowestFailedSample.failedReason}`
      : 'slowestFailedReason=none',
  ].join(' ');
}
