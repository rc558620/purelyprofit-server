import { buildSummaryActionMetaBundle } from './runtime-metrics.summary-context-actions';
import { buildSummaryAggregateMetrics } from './runtime-metrics.summary-context-aggregates';
import { buildCachePrewarmDerivedData } from './runtime-metrics.summary-context-cache-prewarm';
import { buildSummarySeverityState } from './runtime-metrics.summary-context-severity';
import type {
  SummaryBuildContext,
  SummaryMetricsInput,
} from './runtime-metrics.summary-context.types';

export function buildMetricsSummaryContext(
  input: SummaryMetricsInput,
): SummaryBuildContext {
  const aggregateMetrics = buildSummaryAggregateMetrics(input);
  const cachePrewarm = buildCachePrewarmDerivedData(input.cachePrewarm);
  const { status, severity, trend } = buildSummarySeverityState(
    input,
    aggregateMetrics,
    cachePrewarm,
  );
  const actionMetas = buildSummaryActionMetaBundle({
    metrics: input,
    severity,
    aggregateMetrics,
    cachePrewarm,
  });

  return {
    metrics: input,
    status,
    severity,
    trend,
    ...aggregateMetrics,
    ...cachePrewarm,
    ...actionMetas,
  };
}
