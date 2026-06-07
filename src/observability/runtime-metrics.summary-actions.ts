import type {
  SummaryActionMetric,
  SummaryActionPayload,
  SummaryActionTab,
  SummaryProcessFocus,
  SummaryStatus,
} from './metrics-summary.protocol';

export function buildProcessActionPayload(
  focus: SummaryProcessFocus,
  severity: SummaryStatus,
): SummaryActionPayload {
  const tab: SummaryActionTab =
    focus === 'cpu'
      ? 'process.cpu'
      : focus === 'heap'
        ? 'process.heap'
        : 'process.rss';
  const metric: SummaryActionMetric =
    focus === 'cpu'
      ? 'process.cpu_utilization'
      : focus === 'heap'
        ? 'process.heap_pressure'
        : 'process.rss_memory';

  return {
    section: 'process',
    panel: 'process.resource_overview',
    tab,
    metric,
    focus,
    severity,
  };
}

export function buildHttpActionPayload(
  hasErrors: boolean,
  route: string | null,
): SummaryActionPayload {
  return {
    section: 'http',
    panel: 'http.request_diagnostics',
    tab: hasErrors ? 'http.top_routes' : 'http.slow_requests',
    metric: hasErrors ? 'http.error_rate' : 'http.latency',
    route,
  };
}

export function buildSqlActionPayload(
  operation: string | null,
): SummaryActionPayload {
  return {
    section: 'sql',
    panel: 'sql.query_diagnostics',
    tab: 'sql.slow_queries',
    metric: 'sql.slow_query_rate',
    operation,
  };
}

export function buildRedisActionPayload(
  lowHitRate: boolean,
  command: string | null,
): SummaryActionPayload {
  return {
    section: 'redis',
    panel: 'redis.cache_diagnostics',
    tab: lowHitRate ? 'redis.commands' : 'redis.slow_operations',
    metric: lowHitRate ? 'redis.hit_rate' : 'redis.latency',
    command,
  };
}

export function buildCachePrewarmActionPayload(
  hasFailures: boolean,
  invalidCount: number,
  category: string | null,
): SummaryActionPayload {
  return {
    section: 'cachePrewarm',
    panel: 'cache_prewarm.diagnostics',
    tab: hasFailures
      ? 'cache_prewarm.failed_samples'
      : 'cache_prewarm.recent_cycles',
    metric: hasFailures
      ? 'cache_prewarm.failure_rate'
      : invalidCount > 0
        ? 'cache_prewarm.invalid_key_count'
        : 'cache_prewarm.latency',
    category,
  };
}
