import type { SummaryCachePrewarmCategory } from './metrics-summary.protocol';

export type HttpRouteMetric = {
  method: string;
  route: string;
  totalRequests: number;
  errorRequests: number;
  slowRequests: number;
  totalDurationMs: number;
  maxDurationMs: number;
  lastStatusCode: number;
  lastDurationMs: number;
  lastSeenAt: string;
};

export type SlowRequestSample = {
  method: string;
  route: string;
  statusCode: number;
  durationMs: number;
  requestId: string;
  capturedAt: string;
};

export type SlowSqlSample = {
  durationMs: number;
  operation: string;
  target: string;
  queryPreview: string;
  capturedAt: string;
};

export type RedisCommandMetric = {
  command: string;
  totalCalls: number;
  hitCount: number;
  missCount: number;
  slowCalls: number;
  totalDurationMs: number;
  maxDurationMs: number;
  lastDurationMs: number;
  lastSeenAt: string;
};

export type SlowRedisSample = {
  command: string;
  durationMs: number;
  outcome: 'hit' | 'miss' | 'neutral';
  capturedAt: string;
};

export type CachePrewarmDurationDistribution = {
  sampleCount: number;
  totalDurationMs: number;
  avgDurationMs: number;
  minDurationMs: number;
  maxDurationMs: number;
  p50DurationMs: number;
  p95DurationMs: number;
};

export type CachePrewarmSlowKeySample = {
  category: SummaryCachePrewarmCategory;
  cacheKey: string;
  durationMs: number;
  status: 'refreshed' | 'failed';
  errorTag: string | null;
  failedReason: string | null;
};

export type CachePrewarmCycleMetric = {
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
  financeReportHitCount: number;
  marketingOverviewHitCount: number;
  membersMetaHitCount: number;
  membersOverviewHitCount: number;
  profitDetailHitCount: number;
  profitReportHitCount: number;
  costsStatsHitCount: number;
  costsReportHitCount: number;
  failedKeyCountByCategory: Record<string, number>;
  slowestFailedReason: string | null;
  durationDistribution: Record<string, CachePrewarmDurationDistribution>;
  slowKeySamples: CachePrewarmSlowKeySample[];
  capturedAt: string;
};

export type CachePrewarmFailedReasonMetric = {
  errorTag: string;
  failedReason: string;
  count: number;
};

export type CachePrewarmFailedReasonByCategoryMetric = {
  category: CachePrewarmSlowKeySample['category'];
  failedCount: number;
  topReasons: CachePrewarmFailedReasonMetric[];
};

export type CachePrewarmLastFailedAtByCategoryMetric = Record<SummaryCachePrewarmCategory, string | null>;

export type CachePrewarmLastFailedKeyByCategoryMetric = Record<SummaryCachePrewarmCategory, string | null>;

export type CachePrewarmLastFailedSample = {
  capturedAt: string;
  cacheKey: string;
  durationMs: number;
  errorTag: string;
  failedReason: string;
};

export type CachePrewarmLastFailedSampleByCategoryMetric = Record<SummaryCachePrewarmCategory, CachePrewarmLastFailedSample | null>;

export type CachePrewarmMetric = {
  totalCycles: number;
  totalDurationMs: number;
  maxDurationMs: number;
  hitCount: number;
  refreshedCount: number;
  skippedCount: number;
  invalidCount: number;
  failedCount: number;
  lastDurationMs: number;
  lastSeenAt: string | null;
  recentCycles: CachePrewarmCycleMetric[];
};

export type RuntimeMetricsState = {
  startedAtMs: number;
  http: {
    totalRequests: number;
    errorRequests: number;
    totalDurationMs: number;
    maxDurationMs: number;
    routes: Map<string, HttpRouteMetric>;
    slowRequests: SlowRequestSample[];
  };
  sql: {
    totalQueries: number;
    totalDurationMs: number;
    maxDurationMs: number;
    slowQueries: number;
    byOperation: Map<string, { totalQueries: number; totalDurationMs: number }>;
    recentSlowQueries: SlowSqlSample[];
  };
  redis: {
    totalCalls: number;
    totalDurationMs: number;
    maxDurationMs: number;
    commands: Map<string, RedisCommandMetric>;
    recentSlowOperations: SlowRedisSample[];
  };
  cachePrewarm: CachePrewarmMetric;
};

export const MAX_ROUTE_METRICS = 200;
export const MAX_SAMPLE_ITEMS = 20;
export const MAX_FAILED_REASON_ITEMS = 5;
export const MAX_TOP_HIGHLIGHTS = 3;
export const PROCESS_CPU_STARTED = process.cpuUsage();

export const runtimeMetricsState: RuntimeMetricsState = {
  startedAtMs: Date.now(),
  http: {
    totalRequests: 0,
    errorRequests: 0,
    totalDurationMs: 0,
    maxDurationMs: 0,
    routes: new Map<string, HttpRouteMetric>(),
    slowRequests: [],
  },
  sql: {
    totalQueries: 0,
    totalDurationMs: 0,
    maxDurationMs: 0,
    slowQueries: 0,
    byOperation: new Map<
      string,
      { totalQueries: number; totalDurationMs: number }
    >(),
    recentSlowQueries: [],
  },
  redis: {
    totalCalls: 0,
    totalDurationMs: 0,
    maxDurationMs: 0,
    commands: new Map<string, RedisCommandMetric>(),
    recentSlowOperations: [],
  },
  cachePrewarm: {
    totalCycles: 0,
    totalDurationMs: 0,
    maxDurationMs: 0,
    hitCount: 0,
    refreshedCount: 0,
    skippedCount: 0,
    invalidCount: 0,
    failedCount: 0,
    lastDurationMs: 0,
    lastSeenAt: null,
    recentCycles: [],
  },
};

export function pushCappedItem<T>(items: T[], item: T): void {
  items.unshift(item);
  if (items.length > MAX_SAMPLE_ITEMS) {
    items.length = MAX_SAMPLE_ITEMS;
  }
}

export function limitMapEntries<T>(map: Map<string, T>): void {
  if (map.size <= MAX_ROUTE_METRICS) {
    return;
  }

  const oldestKey = map.keys().next().value;
  if (oldestKey) {
    map.delete(oldestKey);
  }
}

export function roundMetric(value: number): number {
  return Number(value.toFixed(2));
}

export function normalizeQueryWhitespace(query: string): string {
  return query.replace(/\s+/g, ' ').trim();
}

export function resolveOperation(query: string): string {
  const [operation = 'unknown'] = normalizeQueryWhitespace(query).split(' ');
  return operation.toUpperCase();
}
