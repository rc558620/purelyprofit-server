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

export function recordCachePrewarmCycle(input: {
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
  failedKeyCountByCategory: {
    dashboardHome: number;
    businessAnalysis: number;
    financeOverview: number;
    marketingOverview: number;
    membersMeta: number;
    membersOverview: number;
  };
  slowestFailedReason: string | null;
  durationDistribution: {
    dashboardHome: CachePrewarmDurationDistribution;
    businessAnalysis: CachePrewarmDurationDistribution;
    financeOverview: CachePrewarmDurationDistribution;
    marketingOverview: CachePrewarmDurationDistribution;
    membersMeta: CachePrewarmDurationDistribution;
    membersOverview: CachePrewarmDurationDistribution;
  };
  slowKeySamples: CachePrewarmSlowKeySample[];
}): void {
  const nowIso = new Date().toISOString();
  runtimeMetricsState.cachePrewarm.totalCycles += 1;
  runtimeMetricsState.cachePrewarm.totalDurationMs += input.durationMs;
  runtimeMetricsState.cachePrewarm.maxDurationMs = Math.max(
    runtimeMetricsState.cachePrewarm.maxDurationMs,
    input.durationMs,
  );
  runtimeMetricsState.cachePrewarm.hitCount += input.hitCount;
  runtimeMetricsState.cachePrewarm.refreshedCount += input.refreshedCount;
  runtimeMetricsState.cachePrewarm.skippedCount += input.skippedCount;
  runtimeMetricsState.cachePrewarm.invalidCount += input.invalidCount;
  runtimeMetricsState.cachePrewarm.failedCount += input.failedCount;
  runtimeMetricsState.cachePrewarm.lastDurationMs = input.durationMs;
  runtimeMetricsState.cachePrewarm.lastSeenAt = nowIso;

  pushCappedItem(runtimeMetricsState.cachePrewarm.recentCycles, {
    cycleId: runtimeMetricsState.cachePrewarm.totalCycles,
    durationMs: roundMetric(input.durationMs),
    hitCount: input.hitCount,
    refreshedCount: input.refreshedCount,
    skippedCount: input.skippedCount,
    invalidCount: input.invalidCount,
    failedCount: input.failedCount,
    dashboardHitCount: input.dashboardHitCount,
    businessAnalysisHitCount: input.businessAnalysisHitCount,
    financeOverviewHitCount: input.financeOverviewHitCount,
    marketingOverviewHitCount: input.marketingOverviewHitCount,
    membersMetaHitCount: input.membersMetaHitCount,
    membersOverviewHitCount: input.membersOverviewHitCount,
    failedKeyCountByCategory: {
      dashboardHome: input.failedKeyCountByCategory.dashboardHome,
      businessAnalysis: input.failedKeyCountByCategory.businessAnalysis,
      financeOverview: input.failedKeyCountByCategory.financeOverview,
      marketingOverview: input.failedKeyCountByCategory.marketingOverview,
      membersMeta: input.failedKeyCountByCategory.membersMeta,
      membersOverview: input.failedKeyCountByCategory.membersOverview,
    },
    slowestFailedReason: input.slowestFailedReason,
    durationDistribution: {
      dashboardHome: {
        sampleCount: input.durationDistribution.dashboardHome.sampleCount,
        totalDurationMs: roundMetric(
          input.durationDistribution.dashboardHome.totalDurationMs,
        ),
        avgDurationMs: roundMetric(
          input.durationDistribution.dashboardHome.avgDurationMs,
        ),
        minDurationMs: roundMetric(
          input.durationDistribution.dashboardHome.minDurationMs,
        ),
        maxDurationMs: roundMetric(
          input.durationDistribution.dashboardHome.maxDurationMs,
        ),
        p50DurationMs: roundMetric(
          input.durationDistribution.dashboardHome.p50DurationMs,
        ),
        p95DurationMs: roundMetric(
          input.durationDistribution.dashboardHome.p95DurationMs,
        ),
      },
      businessAnalysis: {
        sampleCount: input.durationDistribution.businessAnalysis.sampleCount,
        totalDurationMs: roundMetric(
          input.durationDistribution.businessAnalysis.totalDurationMs,
        ),
        avgDurationMs: roundMetric(
          input.durationDistribution.businessAnalysis.avgDurationMs,
        ),
        minDurationMs: roundMetric(
          input.durationDistribution.businessAnalysis.minDurationMs,
        ),
        maxDurationMs: roundMetric(
          input.durationDistribution.businessAnalysis.maxDurationMs,
        ),
        p50DurationMs: roundMetric(
          input.durationDistribution.businessAnalysis.p50DurationMs,
        ),
        p95DurationMs: roundMetric(
          input.durationDistribution.businessAnalysis.p95DurationMs,
        ),
      },
      financeOverview: {
        sampleCount: input.durationDistribution.financeOverview.sampleCount,
        totalDurationMs: roundMetric(
          input.durationDistribution.financeOverview.totalDurationMs,
        ),
        avgDurationMs: roundMetric(
          input.durationDistribution.financeOverview.avgDurationMs,
        ),
        minDurationMs: roundMetric(
          input.durationDistribution.financeOverview.minDurationMs,
        ),
        maxDurationMs: roundMetric(
          input.durationDistribution.financeOverview.maxDurationMs,
        ),
        p50DurationMs: roundMetric(
          input.durationDistribution.financeOverview.p50DurationMs,
        ),
        p95DurationMs: roundMetric(
          input.durationDistribution.financeOverview.p95DurationMs,
        ),
      },
      marketingOverview: {
        sampleCount: input.durationDistribution.marketingOverview.sampleCount,
        totalDurationMs: roundMetric(
          input.durationDistribution.marketingOverview.totalDurationMs,
        ),
        avgDurationMs: roundMetric(
          input.durationDistribution.marketingOverview.avgDurationMs,
        ),
        minDurationMs: roundMetric(
          input.durationDistribution.marketingOverview.minDurationMs,
        ),
        maxDurationMs: roundMetric(
          input.durationDistribution.marketingOverview.maxDurationMs,
        ),
        p50DurationMs: roundMetric(
          input.durationDistribution.marketingOverview.p50DurationMs,
        ),
        p95DurationMs: roundMetric(
          input.durationDistribution.marketingOverview.p95DurationMs,
        ),
      },
      membersMeta: {
        sampleCount: input.durationDistribution.membersMeta.sampleCount,
        totalDurationMs: roundMetric(
          input.durationDistribution.membersMeta.totalDurationMs,
        ),
        avgDurationMs: roundMetric(
          input.durationDistribution.membersMeta.avgDurationMs,
        ),
        minDurationMs: roundMetric(
          input.durationDistribution.membersMeta.minDurationMs,
        ),
        maxDurationMs: roundMetric(
          input.durationDistribution.membersMeta.maxDurationMs,
        ),
        p50DurationMs: roundMetric(
          input.durationDistribution.membersMeta.p50DurationMs,
        ),
        p95DurationMs: roundMetric(
          input.durationDistribution.membersMeta.p95DurationMs,
        ),
      },
      membersOverview: {
        sampleCount: input.durationDistribution.membersOverview.sampleCount,
        totalDurationMs: roundMetric(
          input.durationDistribution.membersOverview.totalDurationMs,
        ),
        avgDurationMs: roundMetric(
          input.durationDistribution.membersOverview.avgDurationMs,
        ),
        minDurationMs: roundMetric(
          input.durationDistribution.membersOverview.minDurationMs,
        ),
        maxDurationMs: roundMetric(
          input.durationDistribution.membersOverview.maxDurationMs,
        ),
        p50DurationMs: roundMetric(
          input.durationDistribution.membersOverview.p50DurationMs,
        ),
        p95DurationMs: roundMetric(
          input.durationDistribution.membersOverview.p95DurationMs,
        ),
      },
    },
    slowKeySamples: input.slowKeySamples.map((sample) => ({
      ...sample,
      durationMs: roundMetric(sample.durationMs),
      errorTag: sample.errorTag,
      failedReason: sample.failedReason,
    })),
    capturedAt: nowIso,
  });
}
