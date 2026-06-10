export const SUMMARY_PROTOCOL_VERSION = '1.0.0' as const;
export const SUMMARY_ACTION_VERSION = '1.0.0' as const;
export const SUMMARY_ACTION_TEXT_MODE = 'display_only' as const;

export type SummaryStatus = 'healthy' | 'warning' | 'critical';
export type SummaryTrend = 'stable' | 'watch' | 'degrading';
export type SummaryActionType = 'link' | 'drawer' | 'modal' | 'route';
export type SummaryProtocolVersion = typeof SUMMARY_PROTOCOL_VERSION;
export type SummaryActionVersion = typeof SUMMARY_ACTION_VERSION;
export type SummaryActionTextMode = typeof SUMMARY_ACTION_TEXT_MODE;

export type SummaryActionId =
  | 'open_process_resource_panel'
  | 'open_http_top_routes'
  | 'open_http_slow_requests'
  | 'open_sql_slow_queries'
  | 'open_redis_commands'
  | 'open_redis_slow_operations'
  | 'open_cache_prewarm_failed_samples'
  | 'open_cache_prewarm_recent_cycles';

export type SummaryOwnerType =
  | 'backend_oncall'
  | 'api_owner'
  | 'dba_owner'
  | 'cache_owner'
  | 'prewarm_owner';

export type SummaryImpactScope =
  | 'instance'
  | 'route'
  | 'database'
  | 'cache'
  | 'cache_prewarm';

export type SummaryImpactLevel = 'low' | 'medium' | 'high' | 'urgent';
export type SummaryDomain =
  | 'process'
  | 'http'
  | 'sql'
  | 'redis'
  | 'cachePrewarm';
export type SummaryProcessFocus = 'cpu' | 'heap' | 'rss';
export type SummaryCachePrewarmCategory =
  | 'dashboardHome'
  | 'businessAnalysis'
  | 'financeOverview'
  | 'marketingOverview'
  | 'membersMeta'
  | 'membersOverview';

export type SummaryActionPanel =
  | 'process.resource_overview'
  | 'http.request_diagnostics'
  | 'sql.query_diagnostics'
  | 'redis.cache_diagnostics'
  | 'cache_prewarm.diagnostics';

export type SummaryActionTab =
  | 'process.cpu'
  | 'process.heap'
  | 'process.rss'
  | 'http.top_routes'
  | 'http.slow_requests'
  | 'sql.slow_queries'
  | 'redis.commands'
  | 'redis.slow_operations'
  | 'cache_prewarm.failed_samples'
  | 'cache_prewarm.recent_cycles';

export type SummaryActionMetric =
  | 'process.cpu_utilization'
  | 'process.heap_pressure'
  | 'process.rss_memory'
  | 'http.error_rate'
  | 'http.latency'
  | 'sql.slow_query_rate'
  | 'redis.hit_rate'
  | 'redis.latency'
  | 'cache_prewarm.failure_rate'
  | 'cache_prewarm.invalid_key_count'
  | 'cache_prewarm.latency';

export type SummaryActionTargetById = {
  open_process_resource_panel: 'process.resource_panel';
  open_http_top_routes: 'http.top_routes';
  open_http_slow_requests: 'http.slow_requests';
  open_sql_slow_queries: 'sql.slow_queries';
  open_redis_commands: 'redis.commands';
  open_redis_slow_operations: 'redis.slow_operations';
  open_cache_prewarm_failed_samples: 'cache_prewarm.failed_samples';
  open_cache_prewarm_recent_cycles: 'cache_prewarm.recent_cycles';
};

export const SUMMARY_ACTION_TARGETS: SummaryActionTargetById = {
  open_process_resource_panel: 'process.resource_panel',
  open_http_top_routes: 'http.top_routes',
  open_http_slow_requests: 'http.slow_requests',
  open_sql_slow_queries: 'sql.slow_queries',
  open_redis_commands: 'redis.commands',
  open_redis_slow_operations: 'redis.slow_operations',
  open_cache_prewarm_failed_samples: 'cache_prewarm.failed_samples',
  open_cache_prewarm_recent_cycles: 'cache_prewarm.recent_cycles',
};

export type SummaryActionTarget = SummaryActionTargetById[SummaryActionId];

export type SummaryActionParamsById = {
  open_process_resource_panel: {
    section: 'process';
    focus: SummaryProcessFocus;
    severity: SummaryStatus;
  };
  open_http_top_routes: {
    section: 'http';
    tab: 'topRoutes';
    route: string | null;
  };
  open_http_slow_requests: {
    section: 'http';
    tab: 'slowRequests';
    route: string | null;
  };
  open_sql_slow_queries: {
    section: 'sql';
    tab: 'slowQueries';
    operation: string | null;
  };
  open_redis_commands: {
    section: 'redis';
    tab: 'commands';
    command: string | null;
  };
  open_redis_slow_operations: {
    section: 'redis';
    tab: 'slowOperations';
    command: string | null;
  };
  open_cache_prewarm_failed_samples: {
    section: 'cachePrewarm';
    tab: 'failedSamples';
    category: SummaryCachePrewarmCategory | null;
  };
  open_cache_prewarm_recent_cycles: {
    section: 'cachePrewarm';
    tab: 'recentCycles';
    category: SummaryCachePrewarmCategory | null;
  };
};

export type SummaryActionParams = SummaryActionParamsById[SummaryActionId];
export type SummaryActionPayloadValue = string | number | boolean | null;

export type SummaryActionPayload = {
  section: SummaryDomain;
  panel: SummaryActionPanel;
  tab: SummaryActionTab;
  metric: SummaryActionMetric;
} & Record<string, SummaryActionPayloadValue>;

export type SummaryHighlight = {
  domain: SummaryDomain;
  severity: SummaryStatus;
  priority: number;
  code: string;
  title: string;
  detail: string;
  label: string;
  message: string;
  actionId: SummaryActionId;
  actionVersion: SummaryActionVersion;
  actionType: SummaryActionType;
  actionText: string;
  actionTextMode: SummaryActionTextMode;
  actionTarget: SummaryActionTarget;
  actionParams: SummaryActionParams;
  actionPayload: SummaryActionPayload;
  owner: string;
  ownerType: SummaryOwnerType;
  responsibleTeam: string;
  eta: string;
  impactLevel: SummaryImpactLevel;
  impactScope: SummaryImpactScope;
  value: string | number | null;
  observedAt: string | null;
};

export type MetricsSummarySeverityMap = Record<SummaryDomain, SummaryStatus>;

export type MetricsSummaryActionMeta = Pick<
  SummaryHighlight,
  | 'actionId'
  | 'actionVersion'
  | 'actionType'
  | 'actionText'
  | 'actionTextMode'
  | 'actionTarget'
  | 'actionParams'
  | 'actionPayload'
  | 'owner'
  | 'ownerType'
  | 'responsibleTeam'
  | 'eta'
  | 'impactLevel'
  | 'impactScope'
>;

export type MetricsSummaryOverview = {
  uptimeSeconds: number;
  totalRequests: number;
  totalQueries: number;
  totalRedisCalls: number;
  totalPrewarmCycles: number;
};

export type MetricsSummaryProcessCard = MetricsSummaryActionMeta & {
  severity: SummaryStatus;
  trend: SummaryTrend;
  label: string;
  message: string;
  suggestion: string;
  rssMb: number;
  heapUsedMb: number;
  approxCpuUtilizationPercent: number;
  memoryPressurePercent: number;
};

export type MetricsSummaryHttpTopRoute = {
  method: string;
  route: string;
  totalRequests: number;
  errorRequests: number;
  errorRatePercent: number;
  slowRequests: number;
  avgDurationMs: number;
  maxDurationMs: number;
  lastStatusCode: number;
  lastDurationMs: number;
  lastSeenAt: string;
};

export type MetricsSummaryHttpCard = MetricsSummaryActionMeta & {
  severity: SummaryStatus;
  trend: SummaryTrend;
  label: string;
  message: string;
  suggestion: string;
  totalRequests: number;
  errorRequests: number;
  errorRatePercent: number;
  avgDurationMs: number;
  maxDurationMs: number;
  slowRequestCount: number;
  slowRequestRatePercent: number;
  latestSlowRequestAt: string | null;
  topRoute: MetricsSummaryHttpTopRoute | null;
};

export type MetricsSummarySqlTopOperation = {
  operation: string;
  totalQueries: number;
  avgDurationMs: number;
};

export type MetricsSummarySqlCard = MetricsSummaryActionMeta & {
  severity: SummaryStatus;
  trend: SummaryTrend;
  label: string;
  message: string;
  suggestion: string;
  totalQueries: number;
  slowQueries: number;
  slowQueryRatePercent: number;
  avgDurationMs: number;
  maxDurationMs: number;
  latestSlowQueryAt: string | null;
  topOperation: MetricsSummarySqlTopOperation | null;
};

export type MetricsSummaryRedisTopCommand = {
  command: string;
  totalCalls: number;
  hitCount: number;
  missCount: number;
  hitRatePercent: number | null;
  slowCalls: number;
  avgDurationMs: number;
  maxDurationMs: number;
  lastDurationMs: number;
  lastSeenAt: string;
};

export type MetricsSummaryRedisCard = MetricsSummaryActionMeta & {
  severity: SummaryStatus;
  trend: SummaryTrend;
  label: string;
  message: string;
  suggestion: string;
  totalCalls: number;
  avgDurationMs: number;
  maxDurationMs: number;
  slowOperationCount: number;
  overallHitRatePercent: number | null;
  latestSlowOperationAt: string | null;
  topCommand: MetricsSummaryRedisTopCommand | null;
};

export type MetricsSummaryCachePrewarmLatestCycle = {
  cycleId: number;
  capturedAt: string;
  durationMs: number;
  hitCount: number;
  refreshedCount: number;
  skippedCount: number;
  invalidCount: number;
  failedCount: number;
};

export type MetricsSummaryCachePrewarmHottestCategory = {
  category: SummaryCachePrewarmCategory;
  sampleCount: number;
  avgDurationMs: number;
  p95DurationMs: number;
  maxDurationMs: number;
};

export type MetricsSummaryCachePrewarmFailedReason = {
  errorTag: string | null;
  failedReason: string | null;
  count: number;
};

export type MetricsSummaryCachePrewarmFailedSample = {
  capturedAt: string;
  cacheKey: string;
  durationMs: number;
  errorTag: string | null;
  failedReason: string | null;
};

export type MetricsSummaryCachePrewarmFailedCategory = {
  category: SummaryCachePrewarmCategory;
  failedCount: number;
  topReason: MetricsSummaryCachePrewarmFailedReason | null;
  lastFailedAt: string | null;
  lastFailedKey: string | null;
  lastFailedSample: MetricsSummaryCachePrewarmFailedSample | null;
};

export type MetricsSummaryCachePrewarmLatestFailedCategory = {
  category: SummaryCachePrewarmCategory;
  lastFailedAt: string | null;
  lastFailedKey: string | null;
  lastFailedSample: MetricsSummaryCachePrewarmFailedSample | null;
};

export type MetricsSummaryCachePrewarmCard = MetricsSummaryActionMeta & {
  severity: SummaryStatus;
  trend: SummaryTrend;
  label: string;
  message: string;
  suggestion: string;
  totalCycles: number;
  totalKeys: number;
  failedCount: number;
  invalidCount: number;
  failureRatePercent: number | null;
  avgDurationMs: number;
  maxDurationMs: number;
  lastDurationMs: number;
  lastSeenAt: string | null;
  latestCycle: MetricsSummaryCachePrewarmLatestCycle | null;
  hottestCategoryByP95: MetricsSummaryCachePrewarmHottestCategory | null;
  mostFailedCategory: MetricsSummaryCachePrewarmFailedCategory | null;
  latestFailedCategory: MetricsSummaryCachePrewarmLatestFailedCategory | null;
  topFailedReason: MetricsSummaryCachePrewarmFailedReason | null;
};

export type MetricsSummary = {
  protocolVersion: SummaryProtocolVersion;
  actionTextMode: SummaryActionTextMode;
  generatedAt: string;
  status: SummaryStatus;
  severity: MetricsSummarySeverityMap;
  highlights: SummaryHighlight[];
  topHighlights: SummaryHighlight[];
  overview: MetricsSummaryOverview;
  process: MetricsSummaryProcessCard;
  http: MetricsSummaryHttpCard;
  sql: MetricsSummarySqlCard;
  redis: MetricsSummaryRedisCard;
  cachePrewarm: MetricsSummaryCachePrewarmCard;
};
