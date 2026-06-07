import type { SummaryHighlight } from './metrics-summary.protocol';
import type { SummaryBuildContext } from './runtime-metrics.summary-context.types';
import { buildSummaryHighlight } from './runtime-metrics.summary-highlights-shared';

export function buildCachePrewarmSummaryHighlights(
  context: SummaryBuildContext,
): SummaryHighlight[] {
  const {
    metrics: input,
    severity,
    cachePrewarmFailureRatePercent,
    cachePrewarmActionMeta,
  } = context;

  if (severity.cachePrewarm === 'healthy') {
    return [];
  }

  const hasFailures = input.cachePrewarm.failedCount > 0;

  return [
    buildSummaryHighlight({
      domain: 'cachePrewarm',
      severity: severity.cachePrewarm,
      priority: hasFailures
        ? severity.cachePrewarm === 'critical'
          ? 100
          : 72
        : severity.cachePrewarm === 'critical'
          ? 76
          : 54,
      code: hasFailures
        ? 'CACHE_PREWARM_FAILURES_DETECTED'
        : 'CACHE_PREWARM_INVALID_KEYS_DETECTED',
      title: hasFailures
        ? 'Cache prewarm failures were detected'
        : 'Cache prewarm invalid keys were detected',
      detail: hasFailures
        ? `${input.cachePrewarm.failedCount} failed refreshes across ${input.cachePrewarm.totalCycles} cycles`
        : `${input.cachePrewarm.invalidCount} invalid cache keys were skipped`,
      label: hasFailures ? '缓存预热异常' : '缓存预热存在无效 Key',
      message: hasFailures
        ? `累计失败 ${input.cachePrewarm.failedCount} 次，失败率 ${cachePrewarmFailureRatePercent}%。`
        : `发现 ${input.cachePrewarm.invalidCount} 个无效 Key 被跳过。`,
      actionMeta: cachePrewarmActionMeta,
      value: hasFailures
        ? cachePrewarmFailureRatePercent
        : input.cachePrewarm.invalidCount,
      observedAt: input.cachePrewarm.lastSeenAt,
    }),
  ];
}
