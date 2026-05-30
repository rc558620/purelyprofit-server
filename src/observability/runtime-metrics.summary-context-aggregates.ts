import { roundMetric, runtimeMetricsState } from './runtime-metrics.state';
import type {
  SummaryAggregateMetrics,
  SummaryMetricsInput,
} from './runtime-metrics.summary-context.types';
import { buildRatePercent } from './runtime-metrics.summary-helpers';

export function buildSummaryAggregateMetrics(
  input: SummaryMetricsInput,
): SummaryAggregateMetrics {
  const totalHttpSlowRequests = Array.from(
    runtimeMetricsState.http.routes.values(),
  ).reduce((sum, metric) => sum + metric.slowRequests, 0);
  const totalRedisSlowCalls = Array.from(
    runtimeMetricsState.redis.commands.values(),
  ).reduce((sum, metric) => sum + metric.slowCalls, 0);
  const totalRedisHits = Array.from(
    runtimeMetricsState.redis.commands.values(),
  ).reduce((sum, metric) => sum + metric.hitCount, 0);
  const totalRedisMisses = Array.from(
    runtimeMetricsState.redis.commands.values(),
  ).reduce((sum, metric) => sum + metric.missCount, 0);
  const totalRedisResolvedCalls = totalRedisHits + totalRedisMisses;
  const totalPrewarmKeys =
    input.cachePrewarm.hitCount +
    input.cachePrewarm.refreshedCount +
    input.cachePrewarm.skippedCount +
    input.cachePrewarm.invalidCount +
    input.cachePrewarm.failedCount;

  return {
    totalHttpSlowRequests,
    totalRedisSlowCalls,
    totalRedisResolvedCalls,
    totalPrewarmKeys,
    httpErrorRatePercent: buildRatePercent(
      input.http.errorRequests,
      input.http.totalRequests,
    ),
    httpSlowRatePercent: buildRatePercent(
      totalHttpSlowRequests,
      input.http.totalRequests,
    ),
    sqlSlowQueryRatePercent: buildRatePercent(
      input.sql.slowQueries,
      input.sql.totalQueries,
    ),
    redisOverallHitRatePercent: buildRatePercent(
      totalRedisHits,
      totalRedisResolvedCalls,
    ),
    cachePrewarmFailureRatePercent: buildRatePercent(
      input.cachePrewarm.failedCount,
      totalPrewarmKeys,
    ),
    processMemoryPressurePercent:
      input.process.heapTotalMb > 0
        ? roundMetric(
            (input.process.heapUsedMb / input.process.heapTotalMb) * 100,
          )
        : 0,
  };
}
