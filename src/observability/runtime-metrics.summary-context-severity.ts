import type {
  MetricsSummarySeverityMap,
  SummaryStatus,
} from './metrics.protocol';
import type {
  SummaryAggregateMetrics,
  SummaryMetricsInput,
  SummaryTrendMap,
} from './runtime-metrics.summary-context.types';
import type { SummaryCachePrewarmDerivedData } from './runtime-metrics.summary-context-cache-prewarm';
import {
  buildTrendBySeverity,
  maxSummaryStatus,
} from './runtime-metrics.summary-helpers';

export type SummarySeverityState = {
  status: SummaryStatus;
  severity: MetricsSummarySeverityMap;
  trend: SummaryTrendMap;
};

export function buildSummarySeverityState(
  input: SummaryMetricsInput,
  aggregateMetrics: SummaryAggregateMetrics,
  cachePrewarm: SummaryCachePrewarmDerivedData,
): SummarySeverityState {
  const {
    totalRedisSlowCalls,
    totalRedisResolvedCalls,
    httpErrorRatePercent,
    httpSlowRatePercent,
    sqlSlowQueryRatePercent,
    redisOverallHitRatePercent,
    cachePrewarmFailureRatePercent,
    processMemoryPressurePercent,
  } = aggregateMetrics;
  const { latestCycle, hottestCategoryByP95 } = cachePrewarm;

  const severity: MetricsSummarySeverityMap = {
    process: 'healthy',
    http: 'healthy',
    sql: 'healthy',
    redis: 'healthy',
    cachePrewarm: 'healthy',
  };

  if (
    input.process.approxCpuUtilizationPercent >= 85 ||
    processMemoryPressurePercent >= 90 ||
    input.process.rssMb >= 1024
  ) {
    severity.process = 'critical';
  } else if (
    input.process.approxCpuUtilizationPercent >= 60 ||
    processMemoryPressurePercent >= 75 ||
    input.process.rssMb >= 768
  ) {
    severity.process = 'warning';
  }

  if (
    httpErrorRatePercent >= 10 ||
    input.http.maxDurationMs >= 1500 ||
    httpSlowRatePercent >= 30
  ) {
    severity.http = 'critical';
  } else if (
    httpErrorRatePercent > 0 ||
    input.http.maxDurationMs >= 800 ||
    httpSlowRatePercent >= 10
  ) {
    severity.http = 'warning';
  }

  if (sqlSlowQueryRatePercent >= 30 || input.sql.maxDurationMs >= 1000) {
    severity.sql = 'critical';
  } else if (input.sql.slowQueries > 0 || input.sql.maxDurationMs >= 400) {
    severity.sql = 'warning';
  }

  if (
    (totalRedisResolvedCalls > 0 && redisOverallHitRatePercent < 60) ||
    input.redis.maxDurationMs >= 120 ||
    totalRedisSlowCalls >= 10
  ) {
    severity.redis = 'critical';
  } else if (
    (totalRedisResolvedCalls > 0 && redisOverallHitRatePercent < 85) ||
    input.redis.maxDurationMs >= 60 ||
    totalRedisSlowCalls > 0
  ) {
    severity.redis = 'warning';
  }

  if (
    cachePrewarmFailureRatePercent >= 5 ||
    (latestCycle?.failedCount ?? 0) > 0 ||
    input.cachePrewarm.maxDurationMs >= 1500
  ) {
    severity.cachePrewarm = 'critical';
  } else if (
    input.cachePrewarm.invalidCount > 0 ||
    (hottestCategoryByP95?.p95DurationMs ?? 0) >= 500
  ) {
    severity.cachePrewarm = 'warning';
  }

  const status = maxSummaryStatus(
    severity.process,
    severity.http,
    severity.sql,
    severity.redis,
    severity.cachePrewarm,
  );
  const trend: SummaryTrendMap = {
    process: buildTrendBySeverity(severity.process),
    http: buildTrendBySeverity(severity.http),
    sql: buildTrendBySeverity(severity.sql),
    redis: buildTrendBySeverity(severity.redis),
    cachePrewarm: buildTrendBySeverity(severity.cachePrewarm),
  };

  return {
    status,
    severity,
    trend,
  };
}
