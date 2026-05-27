import type { MetricsSnapshot } from './metrics.protocol';
import type { HealthSnapshot } from './observability.protocol';
import { buildMetricsSummary } from './runtime-metrics.summary';
import {
  MAX_FAILED_REASON_ITEMS,
  PROCESS_CPU_STARTED,
  roundMetric,
  runtimeMetricsState,
} from './runtime-metrics.state';
import type {
  CachePrewarmCycleMetric,
  CachePrewarmFailedReasonByCategoryMetric,
  CachePrewarmFailedReasonMetric,
  CachePrewarmLastFailedAtByCategoryMetric,
  CachePrewarmLastFailedKeyByCategoryMetric,
  CachePrewarmLastFailedSampleByCategoryMetric,
  CachePrewarmSlowKeySample,
} from './runtime-metrics.state';

function getProcessSnapshot(): HealthSnapshot['process'] {
  const uptimeSeconds = Math.max(
    (Date.now() - runtimeMetricsState.startedAtMs) / 1000,
    1,
  );
  const memoryUsage = process.memoryUsage();
  const cpuUsage = process.cpuUsage(PROCESS_CPU_STARTED);
  const cpuUsedMs = (cpuUsage.user + cpuUsage.system) / 1000;

  return {
    pid: process.pid,
    nodeVersion: process.version,
    uptimeSeconds: roundMetric(uptimeSeconds),
    cpuUsedMs: roundMetric(cpuUsedMs),
    approxCpuUtilizationPercent: roundMetric(
      (cpuUsedMs / (uptimeSeconds * 1000)) * 100,
    ),
    rssMb: roundMetric(memoryUsage.rss / 1024 / 1024),
    heapUsedMb: roundMetric(memoryUsage.heapUsed / 1024 / 1024),
    heapTotalMb: roundMetric(memoryUsage.heapTotal / 1024 / 1024),
    externalMb: roundMetric(memoryUsage.external / 1024 / 1024),
  };
}

function buildRouteMetricsSnapshot() {
  return Array.from(runtimeMetricsState.http.routes.values())
    .map((metric) => ({
      ...metric,
      avgDurationMs: roundMetric(metric.totalDurationMs / metric.totalRequests),
      totalDurationMs: roundMetric(metric.totalDurationMs),
      maxDurationMs: roundMetric(metric.maxDurationMs),
      lastDurationMs: roundMetric(metric.lastDurationMs),
      errorRatePercent: roundMetric(
        (metric.errorRequests / metric.totalRequests) * 100,
      ),
    }))
    .sort((left, right) => right.totalDurationMs - left.totalDurationMs)
    .slice(0, 20);
}

function buildHttpMetricsSnapshot() {
  return {
    totalRequests: runtimeMetricsState.http.totalRequests,
    errorRequests: runtimeMetricsState.http.errorRequests,
    avgDurationMs:
      runtimeMetricsState.http.totalRequests > 0
        ? roundMetric(
            runtimeMetricsState.http.totalDurationMs /
              runtimeMetricsState.http.totalRequests,
          )
        : 0,
    maxDurationMs: roundMetric(runtimeMetricsState.http.maxDurationMs),
    topRoutes: buildRouteMetricsSnapshot(),
    recentSlowRequests: runtimeMetricsState.http.slowRequests,
  };
}

function buildSqlMetricsSnapshot() {
  return {
    totalQueries: runtimeMetricsState.sql.totalQueries,
    avgDurationMs:
      runtimeMetricsState.sql.totalQueries > 0
        ? roundMetric(
            runtimeMetricsState.sql.totalDurationMs /
              runtimeMetricsState.sql.totalQueries,
          )
        : 0,
    maxDurationMs: roundMetric(runtimeMetricsState.sql.maxDurationMs),
    slowQueries: runtimeMetricsState.sql.slowQueries,
    byOperation: Array.from(runtimeMetricsState.sql.byOperation.entries())
      .map(([operation, metric]) => ({
        operation,
        totalQueries: metric.totalQueries,
        avgDurationMs: roundMetric(
          metric.totalDurationMs / metric.totalQueries,
        ),
        totalDurationMs: roundMetric(metric.totalDurationMs),
      }))
      .sort((left, right) => right.totalDurationMs - left.totalDurationMs),
    recentSlowQueries: runtimeMetricsState.sql.recentSlowQueries,
  };
}

function buildRedisMetricsSnapshot() {
  return {
    totalCalls: runtimeMetricsState.redis.totalCalls,
    avgDurationMs:
      runtimeMetricsState.redis.totalCalls > 0
        ? roundMetric(
            runtimeMetricsState.redis.totalDurationMs /
              runtimeMetricsState.redis.totalCalls,
          )
        : 0,
    maxDurationMs: roundMetric(runtimeMetricsState.redis.maxDurationMs),
    commands: Array.from(runtimeMetricsState.redis.commands.values())
      .map((metric) => ({
        ...metric,
        avgDurationMs: roundMetric(metric.totalDurationMs / metric.totalCalls),
        totalDurationMs: roundMetric(metric.totalDurationMs),
        maxDurationMs: roundMetric(metric.maxDurationMs),
        lastDurationMs: roundMetric(metric.lastDurationMs),
        hitRatePercent:
          metric.hitCount + metric.missCount > 0
            ? roundMetric(
                (metric.hitCount / (metric.hitCount + metric.missCount)) * 100,
              )
            : null,
      }))
      .sort((left, right) => right.totalDurationMs - left.totalDurationMs),
    recentSlowOperations: runtimeMetricsState.redis.recentSlowOperations,
  };
}

function buildFailedReasonMetrics(
  samples: CachePrewarmSlowKeySample[],
): CachePrewarmFailedReasonMetric[] {
  const failedReasonMetrics = new Map<string, CachePrewarmFailedReasonMetric>();

  for (const sample of samples) {
    if (
      sample.status !== 'failed' ||
      !sample.errorTag ||
      !sample.failedReason
    ) {
      continue;
    }

    const metricKey = `${sample.errorTag}\u0000${sample.failedReason}`;
    const existingMetric = failedReasonMetrics.get(metricKey);
    if (existingMetric) {
      existingMetric.count += 1;
      continue;
    }

    failedReasonMetrics.set(metricKey, {
      errorTag: sample.errorTag,
      failedReason: sample.failedReason,
      count: 1,
    });
  }

  return Array.from(failedReasonMetrics.values())
    .sort(
      (left, right) =>
        right.count - left.count ||
        left.errorTag.localeCompare(right.errorTag) ||
        left.failedReason.localeCompare(right.failedReason),
    )
    .slice(0, MAX_FAILED_REASON_ITEMS);
}

function buildCachePrewarmFailedReasonTopN(
  recentCycles: CachePrewarmCycleMetric[],
): CachePrewarmFailedReasonMetric[] {
  return buildFailedReasonMetrics(
    recentCycles.flatMap((cycle) => cycle.slowKeySamples),
  );
}

function buildCachePrewarmFailedReasonTopNByCategory(
  recentCycles: CachePrewarmCycleMetric[],
): CachePrewarmFailedReasonByCategoryMetric[] {
  const categories: CachePrewarmSlowKeySample['category'][] = [
    'dashboardHome',
    'businessAnalysis',
    'financeOverview',
  ];

  return categories
    .map((category) => {
      const categorySamples = recentCycles.flatMap((cycle) =>
        cycle.slowKeySamples.filter(
          (sample) =>
            sample.category === category && sample.status === 'failed',
        ),
      );

      return {
        category,
        failedCount: categorySamples.length,
        topReasons: buildFailedReasonMetrics(categorySamples),
      };
    })
    .sort(
      (left, right) =>
        right.failedCount - left.failedCount ||
        left.category.localeCompare(right.category),
    );
}

function buildCachePrewarmLastFailedAtByCategory(
  recentCycles: CachePrewarmCycleMetric[],
): CachePrewarmLastFailedAtByCategoryMetric {
  const result: CachePrewarmLastFailedAtByCategoryMetric = {
    dashboardHome: null,
    businessAnalysis: null,
    financeOverview: null,
  };

  for (const cycle of recentCycles) {
    const failedCategories = new Set(
      cycle.slowKeySamples
        .filter((sample) => sample.status === 'failed')
        .map((sample) => sample.category),
    );

    for (const category of failedCategories) {
      if (!result[category]) {
        result[category] = cycle.capturedAt;
      }
    }
  }

  return result;
}

function buildCachePrewarmLastFailedKeyByCategory(
  recentCycles: CachePrewarmCycleMetric[],
): CachePrewarmLastFailedKeyByCategoryMetric {
  const result: CachePrewarmLastFailedKeyByCategoryMetric = {
    dashboardHome: null,
    businessAnalysis: null,
    financeOverview: null,
  };

  for (const cycle of recentCycles) {
    for (const sample of cycle.slowKeySamples) {
      if (sample.status !== 'failed' || result[sample.category]) {
        continue;
      }

      result[sample.category] = sample.cacheKey;
    }
  }

  return result;
}

function buildCachePrewarmLastFailedSampleByCategory(
  recentCycles: CachePrewarmCycleMetric[],
): CachePrewarmLastFailedSampleByCategoryMetric {
  const result: CachePrewarmLastFailedSampleByCategoryMetric = {
    dashboardHome: null,
    businessAnalysis: null,
    financeOverview: null,
  };

  for (const cycle of recentCycles) {
    for (const sample of cycle.slowKeySamples) {
      if (
        sample.status !== 'failed' ||
        result[sample.category] ||
        !sample.errorTag ||
        !sample.failedReason
      ) {
        continue;
      }

      result[sample.category] = {
        capturedAt: cycle.capturedAt,
        cacheKey: sample.cacheKey,
        durationMs: sample.durationMs,
        errorTag: sample.errorTag,
        failedReason: sample.failedReason,
      };
    }
  }

  return result;
}

function buildCachePrewarmMetricsSnapshot() {
  const recentCycles = runtimeMetricsState.cachePrewarm.recentCycles;

  return {
    totalCycles: runtimeMetricsState.cachePrewarm.totalCycles,
    avgDurationMs:
      runtimeMetricsState.cachePrewarm.totalCycles > 0
        ? roundMetric(
            runtimeMetricsState.cachePrewarm.totalDurationMs /
              runtimeMetricsState.cachePrewarm.totalCycles,
          )
        : 0,
    maxDurationMs: roundMetric(runtimeMetricsState.cachePrewarm.maxDurationMs),
    hitCount: runtimeMetricsState.cachePrewarm.hitCount,
    refreshedCount: runtimeMetricsState.cachePrewarm.refreshedCount,
    skippedCount: runtimeMetricsState.cachePrewarm.skippedCount,
    invalidCount: runtimeMetricsState.cachePrewarm.invalidCount,
    failedCount: runtimeMetricsState.cachePrewarm.failedCount,
    lastDurationMs: roundMetric(
      runtimeMetricsState.cachePrewarm.lastDurationMs,
    ),
    lastSeenAt: runtimeMetricsState.cachePrewarm.lastSeenAt,
    failedReasonTopN: buildCachePrewarmFailedReasonTopN(recentCycles),
    failedReasonTopNByCategory:
      buildCachePrewarmFailedReasonTopNByCategory(recentCycles),
    lastFailedAtByCategory:
      buildCachePrewarmLastFailedAtByCategory(recentCycles),
    lastFailedKeyByCategory:
      buildCachePrewarmLastFailedKeyByCategory(recentCycles),
    lastFailedSampleByCategory:
      buildCachePrewarmLastFailedSampleByCategory(recentCycles),
    recentCycles,
  };
}


export function getRuntimeMetricsSnapshot(): MetricsSnapshot {
  const generatedAt = new Date().toISOString();
  const processSnapshot = getProcessSnapshot();
  const httpSnapshot = buildHttpMetricsSnapshot();
  const sqlSnapshot = buildSqlMetricsSnapshot();
  const redisSnapshot = buildRedisMetricsSnapshot();
  const cachePrewarmSnapshot = buildCachePrewarmMetricsSnapshot();

  return {
    generatedAt,
    process: processSnapshot,
    summary: buildMetricsSummary({
      generatedAt,
      process: processSnapshot,
      http: httpSnapshot,
      sql: sqlSnapshot,
      redis: redisSnapshot,
      cachePrewarm: cachePrewarmSnapshot,
    }),
    http: httpSnapshot,
    sql: sqlSnapshot,
    redis: redisSnapshot,
    cachePrewarm: cachePrewarmSnapshot,
  };
}

export function getHealthSnapshot(): HealthSnapshot {
  const processSnapshot = getProcessSnapshot();

  return {
    status: 'ok',
    generatedAt: new Date().toISOString(),
    process: processSnapshot,
    counters: {
      httpRequests: runtimeMetricsState.http.totalRequests,
      sqlQueries: runtimeMetricsState.sql.totalQueries,
      redisCalls: runtimeMetricsState.redis.totalCalls,
    },
  };
}
