import type { MetricsSummarySeverityMap } from './metrics.protocol';
import type {
  SummaryAggregateMetrics,
  SummaryBuildContext,
  SummaryMetricsInput,
} from './runtime-metrics.summary-context.types';
import type { SummaryCachePrewarmDerivedData } from './runtime-metrics.summary-context-cache-prewarm';
import { buildCachePrewarmActionMeta } from './runtime-metrics.summary-context-actions-cache-prewarm';
import { buildHttpActionMeta } from './runtime-metrics.summary-context-actions-http';
import { buildProcessActionMeta } from './runtime-metrics.summary-context-actions-process';
import { buildRedisActionMeta } from './runtime-metrics.summary-context-actions-redis';
import { buildSqlActionMeta } from './runtime-metrics.summary-context-actions-sql';

type SummaryActionMetaBundle = Pick<
  SummaryBuildContext,
  | 'processActionMeta'
  | 'httpActionMeta'
  | 'sqlActionMeta'
  | 'redisActionMeta'
  | 'cachePrewarmActionMeta'
>;

type BuildSummaryActionMetaParams = {
  metrics: SummaryMetricsInput;
  severity: MetricsSummarySeverityMap;
  aggregateMetrics: SummaryAggregateMetrics;
  cachePrewarm: SummaryCachePrewarmDerivedData;
};

export function buildSummaryActionMetaBundle(
  params: BuildSummaryActionMetaParams,
): SummaryActionMetaBundle {
  const { metrics: input, severity, aggregateMetrics, cachePrewarm } = params;
  const {
    processMemoryPressurePercent,
    httpErrorRatePercent,
    totalRedisResolvedCalls,
    redisOverallHitRatePercent,
  } = aggregateMetrics;
  const { hottestCategoryByP95, latestFailedCategory } = cachePrewarm;

  return {
    processActionMeta: buildProcessActionMeta(
      input,
      severity.process,
      processMemoryPressurePercent,
    ),
    httpActionMeta: buildHttpActionMeta(
      input,
      severity.http,
      httpErrorRatePercent,
    ),
    sqlActionMeta: buildSqlActionMeta(input, severity.sql),
    redisActionMeta: buildRedisActionMeta(
      input,
      severity.redis,
      totalRedisResolvedCalls,
      redisOverallHitRatePercent,
    ),
    cachePrewarmActionMeta: buildCachePrewarmActionMeta(
      input,
      severity.cachePrewarm,
      hottestCategoryByP95?.category ?? null,
      latestFailedCategory?.category ?? null,
    ),
  };
}
