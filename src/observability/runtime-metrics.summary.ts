import type {
  MetricsCachePrewarmSnapshot,
  MetricsHttpSnapshot,
  MetricsProcessSnapshot,
  MetricsRedisSnapshot,
  MetricsSqlSnapshot,
  MetricsSummary,
} from './metrics.protocol';
import { buildMetricsSummaryResult } from './runtime-metrics.summary-cards';
import { buildMetricsSummaryContext } from './runtime-metrics.summary-context';
import { buildSummaryHighlights } from './runtime-metrics.summary-highlights';

export function buildMetricsSummary(input: {
  generatedAt: string;
  process: MetricsProcessSnapshot;
  http: MetricsHttpSnapshot;
  sql: MetricsSqlSnapshot;
  redis: MetricsRedisSnapshot;
  cachePrewarm: MetricsCachePrewarmSnapshot;
}): MetricsSummary {
  const context = buildMetricsSummaryContext(input);
  const highlights = buildSummaryHighlights(context);

  return buildMetricsSummaryResult(context, highlights);
}
