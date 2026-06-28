import type {
  CachePrewarmCycleMetrics,
} from '../redis/cache-prewarm.types';
import type {
  CachePrewarmDurationDistribution,
  CachePrewarmSlowKeySample,
} from './runtime-metrics.state';
import {
  limitMapEntries,
  normalizeQueryWhitespace,
  pushCappedItem,
  resolveOperation,
  roundMetric,
  runtimeMetricsState,
} from './runtime-metrics.state';

export function resetRuntimeMetrics(): void {
  runtimeMetricsState.startedAtMs = Date.now();

  runtimeMetricsState.http.totalRequests = 0;
  runtimeMetricsState.http.errorRequests = 0;
  runtimeMetricsState.http.totalDurationMs = 0;
  runtimeMetricsState.http.maxDurationMs = 0;
  runtimeMetricsState.http.routes.clear();
  runtimeMetricsState.http.slowRequests.length = 0;

  runtimeMetricsState.sql.totalQueries = 0;
  runtimeMetricsState.sql.totalDurationMs = 0;
  runtimeMetricsState.sql.maxDurationMs = 0;
  runtimeMetricsState.sql.slowQueries = 0;
  runtimeMetricsState.sql.byOperation.clear();
  runtimeMetricsState.sql.recentSlowQueries.length = 0;

  runtimeMetricsState.redis.totalCalls = 0;
  runtimeMetricsState.redis.totalDurationMs = 0;
  runtimeMetricsState.redis.maxDurationMs = 0;
  runtimeMetricsState.redis.commands.clear();
  runtimeMetricsState.redis.recentSlowOperations.length = 0;

  runtimeMetricsState.cachePrewarm.totalCycles = 0;
  runtimeMetricsState.cachePrewarm.totalDurationMs = 0;
  runtimeMetricsState.cachePrewarm.maxDurationMs = 0;
  runtimeMetricsState.cachePrewarm.hitCount = 0;
  runtimeMetricsState.cachePrewarm.refreshedCount = 0;
  runtimeMetricsState.cachePrewarm.skippedCount = 0;
  runtimeMetricsState.cachePrewarm.invalidCount = 0;
  runtimeMetricsState.cachePrewarm.failedCount = 0;
  runtimeMetricsState.cachePrewarm.lastDurationMs = 0;
  runtimeMetricsState.cachePrewarm.lastSeenAt = null;
  runtimeMetricsState.cachePrewarm.recentCycles.length = 0;
}

export function recordHttpRequest(input: {
  method: string;
  route: string;
  statusCode: number;
  durationMs: number;
  requestId: string;
  slowThresholdMs: number;
}): void {
  const route = input.route || 'unknown';
  const metricKey = `${input.method} ${route}`;
  const nowIso = new Date().toISOString();

  runtimeMetricsState.http.totalRequests += 1;
  runtimeMetricsState.http.totalDurationMs += input.durationMs;
  runtimeMetricsState.http.maxDurationMs = Math.max(
    runtimeMetricsState.http.maxDurationMs,
    input.durationMs,
  );

  if (input.statusCode >= 500) {
    runtimeMetricsState.http.errorRequests += 1;
  }

  const existingMetric = runtimeMetricsState.http.routes.get(metricKey) ?? {
    method: input.method,
    route,
    totalRequests: 0,
    errorRequests: 0,
    slowRequests: 0,
    totalDurationMs: 0,
    maxDurationMs: 0,
    lastStatusCode: input.statusCode,
    lastDurationMs: 0,
    lastSeenAt: nowIso,
  };

  existingMetric.totalRequests += 1;
  existingMetric.totalDurationMs += input.durationMs;
  existingMetric.maxDurationMs = Math.max(
    existingMetric.maxDurationMs,
    input.durationMs,
  );
  existingMetric.lastStatusCode = input.statusCode;
  existingMetric.lastDurationMs = input.durationMs;
  existingMetric.lastSeenAt = nowIso;

  if (input.statusCode >= 500) {
    existingMetric.errorRequests += 1;
  }

  if (input.durationMs >= input.slowThresholdMs) {
    existingMetric.slowRequests += 1;
    pushCappedItem(runtimeMetricsState.http.slowRequests, {
      method: input.method,
      route,
      statusCode: input.statusCode,
      durationMs: roundMetric(input.durationMs),
      requestId: input.requestId,
      capturedAt: nowIso,
    });
  }

  runtimeMetricsState.http.routes.set(metricKey, existingMetric);
  limitMapEntries(runtimeMetricsState.http.routes);
}

export function recordSqlQuery(input: {
  query: string;
  durationMs: number;
  slowThresholdMs: number;
}): void {
  const normalizedQuery = normalizeQueryWhitespace(input.query);
  const operation = resolveOperation(normalizedQuery);
  const nowIso = new Date().toISOString();

  runtimeMetricsState.sql.totalQueries += 1;
  runtimeMetricsState.sql.totalDurationMs += input.durationMs;
  runtimeMetricsState.sql.maxDurationMs = Math.max(
    runtimeMetricsState.sql.maxDurationMs,
    input.durationMs,
  );

  const byOperationMetric = runtimeMetricsState.sql.byOperation.get(
    operation,
  ) ?? {
    totalQueries: 0,
    totalDurationMs: 0,
  };
  byOperationMetric.totalQueries += 1;
  byOperationMetric.totalDurationMs += input.durationMs;
  runtimeMetricsState.sql.byOperation.set(operation, byOperationMetric);

  if (input.durationMs >= input.slowThresholdMs) {
    runtimeMetricsState.sql.slowQueries += 1;
    pushCappedItem(runtimeMetricsState.sql.recentSlowQueries, {
      durationMs: roundMetric(input.durationMs),
      operation,
      target: 'postgres',
      queryPreview: normalizedQuery.slice(0, 240),
      capturedAt: nowIso,
    });
  }
}

export function recordRedisOperation(input: {
  command: string;
  durationMs: number;
  outcome: 'hit' | 'miss' | 'neutral';
  slowThresholdMs: number;
}): void {
  const command = input.command.toUpperCase();
  const nowIso = new Date().toISOString();

  runtimeMetricsState.redis.totalCalls += 1;
  runtimeMetricsState.redis.totalDurationMs += input.durationMs;
  runtimeMetricsState.redis.maxDurationMs = Math.max(
    runtimeMetricsState.redis.maxDurationMs,
    input.durationMs,
  );

  const commandMetric = runtimeMetricsState.redis.commands.get(command) ?? {
    command,
    totalCalls: 0,
    hitCount: 0,
    missCount: 0,
    slowCalls: 0,
    totalDurationMs: 0,
    maxDurationMs: 0,
    lastDurationMs: 0,
    lastSeenAt: nowIso,
  };

  commandMetric.totalCalls += 1;
  commandMetric.totalDurationMs += input.durationMs;
  commandMetric.maxDurationMs = Math.max(
    commandMetric.maxDurationMs,
    input.durationMs,
  );
  commandMetric.lastDurationMs = input.durationMs;
  commandMetric.lastSeenAt = nowIso;

  if (input.outcome === 'hit') {
    commandMetric.hitCount += 1;
  }

  if (input.outcome === 'miss') {
    commandMetric.missCount += 1;
  }

  if (input.durationMs >= input.slowThresholdMs) {
    commandMetric.slowCalls += 1;
    pushCappedItem(runtimeMetricsState.redis.recentSlowOperations, {
      command,
      durationMs: roundMetric(input.durationMs),
      outcome: input.outcome,
      capturedAt: nowIso,
    });
  }

  runtimeMetricsState.redis.commands.set(command, commandMetric);
}

export function recordCachePrewarmCycle(metrics: CachePrewarmCycleMetrics): void {
  const nowIso = new Date().toISOString();
  runtimeMetricsState.cachePrewarm.totalCycles += 1;
  runtimeMetricsState.cachePrewarm.totalDurationMs += metrics.durationMs;
  runtimeMetricsState.cachePrewarm.maxDurationMs = Math.max(
    runtimeMetricsState.cachePrewarm.maxDurationMs,
    metrics.durationMs,
  );
  runtimeMetricsState.cachePrewarm.hitCount += metrics.hitCount;
  runtimeMetricsState.cachePrewarm.refreshedCount += metrics.refreshedCount;
  runtimeMetricsState.cachePrewarm.skippedCount += metrics.skippedCount;
  runtimeMetricsState.cachePrewarm.invalidCount += metrics.invalidCount;
  runtimeMetricsState.cachePrewarm.failedCount += metrics.failedCount;
  runtimeMetricsState.cachePrewarm.lastDurationMs = metrics.durationMs;
  runtimeMetricsState.cachePrewarm.lastSeenAt = nowIso;

  const roundDist = (d: CachePrewarmDurationDistribution) => ({
    sampleCount: d.sampleCount,
    totalDurationMs: roundMetric(d.totalDurationMs),
    avgDurationMs: roundMetric(d.avgDurationMs),
    minDurationMs: roundMetric(d.minDurationMs),
    maxDurationMs: roundMetric(d.maxDurationMs),
    p50DurationMs: roundMetric(d.p50DurationMs),
    p95DurationMs: roundMetric(d.p95DurationMs),
  });

  pushCappedItem(runtimeMetricsState.cachePrewarm.recentCycles, {
    cycleId: runtimeMetricsState.cachePrewarm.totalCycles,
    durationMs: roundMetric(metrics.durationMs),
    hitCount: metrics.hitCount,
    refreshedCount: metrics.refreshedCount,
    skippedCount: metrics.skippedCount,
    invalidCount: metrics.invalidCount,
    failedCount: metrics.failedCount,
    dashboardHitCount: metrics.dashboardHitCount,
    businessAnalysisHitCount: metrics.businessAnalysisHitCount,
    financeOverviewHitCount: metrics.financeOverviewHitCount,
    financeReportHitCount: metrics.financeReportHitCount,
    marketingOverviewHitCount: metrics.marketingOverviewHitCount,
    membersMetaHitCount: metrics.membersMetaHitCount,
    membersOverviewHitCount: metrics.membersOverviewHitCount,
    profitDetailHitCount: metrics.profitDetailHitCount,
    profitReportHitCount: metrics.profitReportHitCount,
    costsStatsHitCount: metrics.costsStatsHitCount,
    costsReportHitCount: metrics.costsReportHitCount,
    failedKeyCountByCategory: { ...metrics.failedKeyCountByCategory },
    slowestFailedReason: metrics.slowestFailedReason,
    durationDistribution: Object.fromEntries(
      Object.entries(metrics.durationDistribution).map(([k, v]) => [k, roundDist(v)]),
    ),
    slowKeySamples: metrics.slowKeySamples.map((sample) => ({
      ...sample,
      durationMs: roundMetric(sample.durationMs),
    })),
    capturedAt: nowIso,
  });
}
