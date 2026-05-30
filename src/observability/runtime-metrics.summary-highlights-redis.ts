import type { SummaryHighlight } from './metrics.protocol';
import type { SummaryBuildContext } from './runtime-metrics.summary-context.types';
import { buildSummaryHighlight } from './runtime-metrics.summary-highlights-shared';

export function buildRedisSummaryHighlights(
  context: SummaryBuildContext,
): SummaryHighlight[] {
  const {
    metrics: input,
    severity,
    totalRedisSlowCalls,
    totalRedisResolvedCalls,
    redisOverallHitRatePercent,
    redisActionMeta,
  } = context;

  if (severity.redis === 'healthy') {
    return [];
  }

  const lowHitRate =
    totalRedisResolvedCalls > 0 && redisOverallHitRatePercent < 85;

  return [
    buildSummaryHighlight({
      domain: 'redis',
      severity: severity.redis,
      priority: lowHitRate
        ? severity.redis === 'critical'
          ? 80
          : 57
        : severity.redis === 'critical'
          ? 78
          : 55,
      code: lowHitRate ? 'REDIS_HIT_RATE_LOW' : 'REDIS_SLOW_OPERATIONS_HIGH',
      title: lowHitRate
        ? 'Redis hit rate is low'
        : 'Redis slow operations are elevated',
      detail: lowHitRate
        ? `Hit rate is ${redisOverallHitRatePercent}% across ${totalRedisResolvedCalls} resolved calls`
        : `${totalRedisSlowCalls} slow Redis operations observed`,
      label: lowHitRate ? 'Redis 命中率偏低' : 'Redis 慢操作偏多',
      message: lowHitRate
        ? `当前命中率 ${redisOverallHitRatePercent}%，建议关注缓存预热与过期策略。`
        : `已观测到 ${totalRedisSlowCalls} 次慢操作，峰值耗时 ${input.redis.maxDurationMs}ms。`,
      actionMeta: redisActionMeta,
      value: lowHitRate ? redisOverallHitRatePercent : totalRedisSlowCalls,
      observedAt:
        input.redis.recentSlowOperations[0]?.capturedAt ?? input.generatedAt,
    }),
  ];
}
