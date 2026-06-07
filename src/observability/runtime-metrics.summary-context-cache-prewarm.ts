import type { MetricsCachePrewarmSnapshot } from './metrics-snapshot.protocol';
import type {
  MetricsSummaryCachePrewarmFailedCategory,
  MetricsSummaryCachePrewarmHottestCategory,
  MetricsSummaryCachePrewarmLatestCycle,
  MetricsSummaryCachePrewarmLatestFailedCategory,
} from './metrics-summary.protocol';

export type SummaryCachePrewarmDerivedData = {
  latestCycle: MetricsSummaryCachePrewarmLatestCycle | null;
  hottestCategoryByP95: MetricsSummaryCachePrewarmHottestCategory | null;
  mostFailedCategory: MetricsSummaryCachePrewarmFailedCategory | null;
  latestFailedCategory: MetricsSummaryCachePrewarmLatestFailedCategory | null;
};

export function buildCachePrewarmDerivedData(
  cachePrewarm: MetricsCachePrewarmSnapshot,
): SummaryCachePrewarmDerivedData {
  const latestCycleSnapshot = cachePrewarm.recentCycles[0] ?? null;
  const latestCycle: MetricsSummaryCachePrewarmLatestCycle | null =
    latestCycleSnapshot && {
      cycleId: latestCycleSnapshot.cycleId,
      capturedAt: latestCycleSnapshot.capturedAt,
      durationMs: latestCycleSnapshot.durationMs,
      hitCount: latestCycleSnapshot.hitCount,
      refreshedCount: latestCycleSnapshot.refreshedCount,
      skippedCount: latestCycleSnapshot.skippedCount,
      invalidCount: latestCycleSnapshot.invalidCount,
      failedCount: latestCycleSnapshot.failedCount,
    };

  const hottestCategoryByP95: MetricsSummaryCachePrewarmHottestCategory | null =
    latestCycleSnapshot
      ? ((
          [
            {
              category: 'dashboardHome' as const,
              ...latestCycleSnapshot.durationDistribution.dashboardHome,
            },
            {
              category: 'businessAnalysis' as const,
              ...latestCycleSnapshot.durationDistribution.businessAnalysis,
            },
            {
              category: 'financeOverview' as const,
              ...latestCycleSnapshot.durationDistribution.financeOverview,
            },
          ] as const
        )
          .filter((entry) => entry.sampleCount > 0)
          .sort(
            (left, right) =>
              right.p95DurationMs - left.p95DurationMs ||
              right.maxDurationMs - left.maxDurationMs ||
              left.category.localeCompare(right.category),
          )[0] ?? null)
      : null;

  const mostFailedCategoryMetric =
    cachePrewarm.failedReasonTopNByCategory.find(
      (metric) => metric.failedCount > 0,
    ) ?? null;
  const mostFailedCategory: MetricsSummaryCachePrewarmFailedCategory | null =
    mostFailedCategoryMetric && {
      category: mostFailedCategoryMetric.category,
      failedCount: mostFailedCategoryMetric.failedCount,
      topReason: mostFailedCategoryMetric.topReasons[0] ?? null,
      lastFailedAt:
        cachePrewarm.lastFailedAtByCategory[mostFailedCategoryMetric.category],
      lastFailedKey:
        cachePrewarm.lastFailedKeyByCategory[mostFailedCategoryMetric.category],
      lastFailedSample:
        cachePrewarm.lastFailedSampleByCategory[
          mostFailedCategoryMetric.category
        ],
    };

  const latestFailedCategory: MetricsSummaryCachePrewarmLatestFailedCategory | null =
    (
      [
        {
          category: 'dashboardHome' as const,
          lastFailedAt: cachePrewarm.lastFailedAtByCategory.dashboardHome,
          lastFailedKey: cachePrewarm.lastFailedKeyByCategory.dashboardHome,
          lastFailedSample:
            cachePrewarm.lastFailedSampleByCategory.dashboardHome,
        },
        {
          category: 'businessAnalysis' as const,
          lastFailedAt: cachePrewarm.lastFailedAtByCategory.businessAnalysis,
          lastFailedKey: cachePrewarm.lastFailedKeyByCategory.businessAnalysis,
          lastFailedSample:
            cachePrewarm.lastFailedSampleByCategory.businessAnalysis,
        },
        {
          category: 'financeOverview' as const,
          lastFailedAt: cachePrewarm.lastFailedAtByCategory.financeOverview,
          lastFailedKey: cachePrewarm.lastFailedKeyByCategory.financeOverview,
          lastFailedSample:
            cachePrewarm.lastFailedSampleByCategory.financeOverview,
        },
      ] as const
    )
      .filter((entry) => entry.lastFailedAt)
      .sort(
        (left, right) =>
          (right.lastFailedAt ?? '').localeCompare(left.lastFailedAt ?? '') ||
          left.category.localeCompare(right.category),
      )[0] ?? null;

  return {
    latestCycle,
    hottestCategoryByP95,
    mostFailedCategory,
    latestFailedCategory,
  };
}
