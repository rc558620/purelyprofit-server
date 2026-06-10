import type { ObservabilityProcessSnapshot } from './observability.protocol';
import type {
  MetricsSummary,
  SummaryCachePrewarmCategory,
} from './metrics-summary.protocol';

export type MetricsProcessSnapshot = ObservabilityProcessSnapshot;

export type MetricsHttpRouteSnapshot = {
  method: string;
  route: string;
  totalRequests: number;
  errorRequests: number;
  slowRequests: number;
  totalDurationMs: number;
  avgDurationMs: number;
  maxDurationMs: number;
  errorRatePercent: number;
  lastStatusCode: number;
  lastDurationMs: number;
  lastSeenAt: string;
};

export type MetricsHttpSlowRequestSnapshot = {
  method: string;
  route: string;
  statusCode: number;
  durationMs: number;
  requestId: string;
  capturedAt: string;
};

export type MetricsHttpSnapshot = {
  totalRequests: number;
  errorRequests: number;
  avgDurationMs: number;
  maxDurationMs: number;
  topRoutes: MetricsHttpRouteSnapshot[];
  recentSlowRequests: MetricsHttpSlowRequestSnapshot[];
};

export type MetricsSqlOperationSnapshot = {
  operation: string;
  totalQueries: number;
  avgDurationMs: number;
  totalDurationMs: number;
};

export type MetricsSqlSlowQuerySnapshot = {
  durationMs: number;
  operation: string;
  target: string;
  queryPreview: string;
  capturedAt: string;
};

export type MetricsSqlSnapshot = {
  totalQueries: number;
  avgDurationMs: number;
  maxDurationMs: number;
  slowQueries: number;
  byOperation: MetricsSqlOperationSnapshot[];
  recentSlowQueries: MetricsSqlSlowQuerySnapshot[];
};

export type MetricsRedisCommandSnapshot = {
  command: string;
  totalCalls: number;
  hitCount: number;
  missCount: number;
  slowCalls: number;
  totalDurationMs: number;
  avgDurationMs: number;
  maxDurationMs: number;
  hitRatePercent: number | null;
  lastDurationMs: number;
  lastSeenAt: string;
};

export type MetricsRedisSlowOperationSnapshot = {
  command: string;
  durationMs: number;
  outcome: 'hit' | 'miss' | 'neutral';
  capturedAt: string;
};

export type MetricsRedisSnapshot = {
  totalCalls: number;
  avgDurationMs: number;
  maxDurationMs: number;
  commands: MetricsRedisCommandSnapshot[];
  recentSlowOperations: MetricsRedisSlowOperationSnapshot[];
};

export type MetricsCachePrewarmDurationDistribution = {
  sampleCount: number;
  totalDurationMs: number;
  avgDurationMs: number;
  minDurationMs: number;
  maxDurationMs: number;
  p50DurationMs: number;
  p95DurationMs: number;
};

export type MetricsCachePrewarmSlowKeySample = {
  category: SummaryCachePrewarmCategory;
  cacheKey: string;
  durationMs: number;
  status: 'refreshed' | 'failed';
  errorTag: string | null;
  failedReason: string | null;
};

export type MetricsCachePrewarmCycleSnapshot = {
  cycleId: number;
  durationMs: number;
  hitCount: number;
  refreshedCount: number;
  skippedCount: number;
  invalidCount: number;
  failedCount: number;
  dashboardHitCount: number;
  businessAnalysisHitCount: number;
  financeOverviewHitCount: number;
  marketingOverviewHitCount: number;
  membersMetaHitCount: number;
  membersOverviewHitCount: number;
  failedKeyCountByCategory: Record<SummaryCachePrewarmCategory, number>;
  slowestFailedReason: string | null;
  durationDistribution: Record<
    SummaryCachePrewarmCategory,
    MetricsCachePrewarmDurationDistribution
  >;
  slowKeySamples: MetricsCachePrewarmSlowKeySample[];
  capturedAt: string;
};

export type MetricsCachePrewarmFailedReasonSnapshot = {
  errorTag: string;
  failedReason: string;
  count: number;
};

export type MetricsCachePrewarmFailedReasonByCategorySnapshot = {
  category: SummaryCachePrewarmCategory;
  failedCount: number;
  topReasons: MetricsCachePrewarmFailedReasonSnapshot[];
};

export type MetricsCachePrewarmLastFailedAtByCategorySnapshot = Record<
  SummaryCachePrewarmCategory,
  string | null
>;

export type MetricsCachePrewarmLastFailedKeyByCategorySnapshot = Record<
  SummaryCachePrewarmCategory,
  string | null
>;

export type MetricsCachePrewarmLastFailedSampleSnapshot = {
  capturedAt: string;
  cacheKey: string;
  durationMs: number;
  errorTag: string;
  failedReason: string;
};

export type MetricsCachePrewarmLastFailedSampleByCategorySnapshot = Record<
  SummaryCachePrewarmCategory,
  MetricsCachePrewarmLastFailedSampleSnapshot | null
>;

export type MetricsCachePrewarmSnapshot = {
  totalCycles: number;
  avgDurationMs: number;
  maxDurationMs: number;
  hitCount: number;
  refreshedCount: number;
  skippedCount: number;
  invalidCount: number;
  failedCount: number;
  lastDurationMs: number;
  lastSeenAt: string | null;
  failedReasonTopN: MetricsCachePrewarmFailedReasonSnapshot[];
  failedReasonTopNByCategory: MetricsCachePrewarmFailedReasonByCategorySnapshot[];
  lastFailedAtByCategory: MetricsCachePrewarmLastFailedAtByCategorySnapshot;
  lastFailedKeyByCategory: MetricsCachePrewarmLastFailedKeyByCategorySnapshot;
  lastFailedSampleByCategory: MetricsCachePrewarmLastFailedSampleByCategorySnapshot;
  recentCycles: MetricsCachePrewarmCycleSnapshot[];
};

export type MetricsSnapshot = {
  generatedAt: string;
  process: MetricsProcessSnapshot;
  summary: MetricsSummary;
  http: MetricsHttpSnapshot;
  sql: MetricsSqlSnapshot;
  redis: MetricsRedisSnapshot;
  cachePrewarm: MetricsCachePrewarmSnapshot;
};
