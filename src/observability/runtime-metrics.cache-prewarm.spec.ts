import type {
  MetricsCachePrewarmCycleSnapshot,
  MetricsCachePrewarmDurationDistribution,
  MetricsCachePrewarmSnapshot,
} from './metrics-snapshot.protocol';
import { resetRuntimeMetrics } from './runtime-metrics.recorders';
import { buildCachePrewarmSummaryHighlights } from './runtime-metrics.summary-highlights-cache-prewarm';
import { buildCachePrewarmActionMeta } from './runtime-metrics.summary-context-actions-cache-prewarm';
import { buildCachePrewarmDerivedData } from './runtime-metrics.summary-context-cache-prewarm';
import { buildMetricsSummaryContext } from './runtime-metrics.summary-context';
import type { SummaryMetricsInput } from './runtime-metrics.summary-context.types';

function createDurationDistribution(
  sampleCount: number,
  avgDurationMs: number,
  maxDurationMs: number,
  p95DurationMs: number,
): MetricsCachePrewarmDurationDistribution {
  return {
    sampleCount,
    totalDurationMs: sampleCount * avgDurationMs,
    avgDurationMs,
    minDurationMs: sampleCount > 0 ? avgDurationMs : 0,
    maxDurationMs,
    p50DurationMs: avgDurationMs,
    p95DurationMs,
  };
}

function createCycleSnapshot(
  overrides: Partial<MetricsCachePrewarmCycleSnapshot> = {},
): MetricsCachePrewarmCycleSnapshot {
  return {
    cycleId: 1,
    durationMs: 120,
    hitCount: 3,
    refreshedCount: 3,
    skippedCount: 0,
    invalidCount: 0,
    failedCount: 0,
    dashboardHitCount: 1,
    businessAnalysisHitCount: 1,
    financeOverviewHitCount: 1,
    failedKeyCountByCategory: {
      dashboardHome: 0,
      businessAnalysis: 0,
      financeOverview: 0,
    },
    slowestFailedReason: null,
    durationDistribution: {
      dashboardHome: createDurationDistribution(1, 80, 80, 80),
      businessAnalysis: createDurationDistribution(1, 60, 60, 60),
      financeOverview: createDurationDistribution(1, 40, 40, 40),
    },
    slowKeySamples: [],
    capturedAt: '2026-06-08T10:00:00.000Z',
    ...overrides,
  };
}

function createCachePrewarmSnapshot(
  overrides: Partial<MetricsCachePrewarmSnapshot> = {},
): MetricsCachePrewarmSnapshot {
  return {
    totalCycles: 1,
    avgDurationMs: 120,
    maxDurationMs: 120,
    hitCount: 3,
    refreshedCount: 3,
    skippedCount: 0,
    invalidCount: 0,
    failedCount: 0,
    lastDurationMs: 120,
    lastSeenAt: '2026-06-08T10:00:00.000Z',
    failedReasonTopN: [],
    failedReasonTopNByCategory: [
      {
        category: 'dashboardHome',
        failedCount: 0,
        topReasons: [],
      },
      {
        category: 'businessAnalysis',
        failedCount: 0,
        topReasons: [],
      },
      {
        category: 'financeOverview',
        failedCount: 0,
        topReasons: [],
      },
    ],
    lastFailedAtByCategory: {
      dashboardHome: null,
      businessAnalysis: null,
      financeOverview: null,
    },
    lastFailedKeyByCategory: {
      dashboardHome: null,
      businessAnalysis: null,
      financeOverview: null,
    },
    lastFailedSampleByCategory: {
      dashboardHome: null,
      businessAnalysis: null,
      financeOverview: null,
    },
    recentCycles: [createCycleSnapshot()],
    ...overrides,
  };
}

function createSummaryMetricsInput(
  cachePrewarm: MetricsCachePrewarmSnapshot,
): SummaryMetricsInput {
  return {
    generatedAt: '2026-06-08T10:05:00.000Z',
    process: {
      pid: 1,
      nodeVersion: 'v22.0.0',
      uptimeSeconds: 120,
      cpuUsedMs: 30,
      approxCpuUtilizationPercent: 10,
      rssMb: 128,
      heapUsedMb: 32,
      heapTotalMb: 64,
      externalMb: 8,
    },
    http: {
      totalRequests: 0,
      errorRequests: 0,
      avgDurationMs: 0,
      maxDurationMs: 0,
      topRoutes: [],
      recentSlowRequests: [],
    },
    sql: {
      totalQueries: 0,
      avgDurationMs: 0,
      maxDurationMs: 0,
      slowQueries: 0,
      byOperation: [],
      recentSlowQueries: [],
    },
    redis: {
      totalCalls: 0,
      avgDurationMs: 0,
      maxDurationMs: 0,
      commands: [],
      recentSlowOperations: [],
    },
    cachePrewarm,
  };
}

describe('cache prewarm observability helpers', () => {
  beforeEach(() => {
    resetRuntimeMetrics();
  });

  it('buildCachePrewarmDerivedData 会提取 hottest、mostFailed 与 latestFailed 信息', () => {
    const cachePrewarm = createCachePrewarmSnapshot({
      totalCycles: 2,
      avgDurationMs: 160,
      maxDurationMs: 240,
      failedCount: 3,
      failedReasonTopNByCategory: [
        {
          category: 'businessAnalysis',
          failedCount: 2,
          topReasons: [
            {
              errorTag: 'Error',
              failedReason: 'timeout',
              count: 2,
            },
          ],
        },
        {
          category: 'dashboardHome',
          failedCount: 1,
          topReasons: [
            {
              errorTag: 'Error',
              failedReason: 'boom',
              count: 1,
            },
          ],
        },
        {
          category: 'financeOverview',
          failedCount: 0,
          topReasons: [],
        },
      ],
      lastFailedAtByCategory: {
        dashboardHome: '2026-06-08T10:03:00.000Z',
        businessAnalysis: '2026-06-08T10:01:00.000Z',
        financeOverview: null,
      },
      lastFailedKeyByCategory: {
        dashboardHome: 'profit:dashboard:home:store:18:period:today',
        businessAnalysis:
          'profit:business-analysis:store:18:period:month:start:na:end:na',
        financeOverview: null,
      },
      lastFailedSampleByCategory: {
        dashboardHome: {
          capturedAt: '2026-06-08T10:03:00.000Z',
          cacheKey: 'profit:dashboard:home:store:18:period:today',
          durationMs: 180,
          errorTag: 'Error',
          failedReason: 'boom',
        },
        businessAnalysis: {
          capturedAt: '2026-06-08T10:01:00.000Z',
          cacheKey:
            'profit:business-analysis:store:18:period:month:start:na:end:na',
          durationMs: 210,
          errorTag: 'Error',
          failedReason: 'timeout',
        },
        financeOverview: null,
      },
      recentCycles: [
        createCycleSnapshot({
          cycleId: 2,
          durationMs: 240,
          failedCount: 1,
          durationDistribution: {
            dashboardHome: createDurationDistribution(1, 180, 180, 180),
            businessAnalysis: createDurationDistribution(1, 220, 220, 220),
            financeOverview: createDurationDistribution(1, 90, 90, 90),
          },
          slowKeySamples: [
            {
              category: 'dashboardHome',
              cacheKey: 'profit:dashboard:home:store:18:period:today',
              durationMs: 180,
              status: 'failed',
              errorTag: 'Error',
              failedReason: 'boom',
            },
          ],
          capturedAt: '2026-06-08T10:03:00.000Z',
        }),
        createCycleSnapshot({
          cycleId: 1,
          durationMs: 80,
          failedCount: 2,
          durationDistribution: {
            dashboardHome: createDurationDistribution(1, 80, 80, 80),
            businessAnalysis: createDurationDistribution(1, 210, 210, 210),
            financeOverview: createDurationDistribution(1, 70, 70, 70),
          },
          slowKeySamples: [
            {
              category: 'businessAnalysis',
              cacheKey:
                'profit:business-analysis:store:18:period:month:start:na:end:na',
              durationMs: 210,
              status: 'failed',
              errorTag: 'Error',
              failedReason: 'timeout',
            },
          ],
          capturedAt: '2026-06-08T10:01:00.000Z',
        }),
      ],
    });

    const derivedData = buildCachePrewarmDerivedData(cachePrewarm);

    expect(derivedData.latestCycle).toMatchObject({
      cycleId: 2,
      durationMs: 240,
      failedCount: 1,
    });
    expect(derivedData.hottestCategoryByP95).toMatchObject({
      category: 'businessAnalysis',
      p95DurationMs: 220,
    });
    expect(derivedData.mostFailedCategory).toMatchObject({
      category: 'businessAnalysis',
      failedCount: 2,
      topReason: {
        errorTag: 'Error',
        failedReason: 'timeout',
        count: 2,
      },
    });
    expect(derivedData.latestFailedCategory).toMatchObject({
      category: 'dashboardHome',
      lastFailedAt: '2026-06-08T10:03:00.000Z',
      lastFailedKey: 'profit:dashboard:home:store:18:period:today',
    });
  });

  it('buildCachePrewarmActionMeta 在失败时会指向 failed samples 并优先最新失败类别', () => {
    const cachePrewarm = createCachePrewarmSnapshot({
      failedCount: 1,
      invalidCount: 0,
    });

    const actionMeta = buildCachePrewarmActionMeta(
      createSummaryMetricsInput(cachePrewarm),
      'critical',
      'businessAnalysis',
      'dashboardHome',
    );

    expect(actionMeta).toMatchObject({
      actionId: 'open_cache_prewarm_failed_samples',
      actionText: '查看预热失败样本',
      actionParams: {
        section: 'cachePrewarm',
        tab: 'failedSamples',
        category: 'dashboardHome',
      },
      actionPayload: {
        section: 'cachePrewarm',
        panel: 'cache_prewarm.diagnostics',
        tab: 'cache_prewarm.failed_samples',
        metric: 'cache_prewarm.failure_rate',
        category: 'dashboardHome',
      },
      ownerType: 'prewarm_owner',
      impactScope: 'cache_prewarm',
    });
  });

  it('buildCachePrewarmActionMeta 在无失败但有无效 key 时会指向 recent cycles', () => {
    const cachePrewarm = createCachePrewarmSnapshot({
      failedCount: 0,
      invalidCount: 2,
    });

    const actionMeta = buildCachePrewarmActionMeta(
      createSummaryMetricsInput(cachePrewarm),
      'warning',
      'businessAnalysis',
      null,
    );

    expect(actionMeta).toMatchObject({
      actionId: 'open_cache_prewarm_recent_cycles',
      actionText: '查看预热周期明细',
      actionParams: {
        section: 'cachePrewarm',
        tab: 'recentCycles',
        category: 'businessAnalysis',
      },
      actionPayload: {
        section: 'cachePrewarm',
        panel: 'cache_prewarm.diagnostics',
        tab: 'cache_prewarm.recent_cycles',
        metric: 'cache_prewarm.invalid_key_count',
        category: 'businessAnalysis',
      },
    });
  });

  it('buildCachePrewarmSummaryHighlights 会为 invalid key 告警生成直接高亮', () => {
    const cachePrewarm = createCachePrewarmSnapshot({
      invalidCount: 2,
      recentCycles: [
        createCycleSnapshot({
          invalidCount: 2,
          durationDistribution: {
            dashboardHome: createDurationDistribution(1, 120, 120, 120),
            businessAnalysis: createDurationDistribution(1, 180, 180, 180),
            financeOverview: createDurationDistribution(1, 90, 90, 90),
          },
        }),
      ],
    });
    const context = buildMetricsSummaryContext(
      createSummaryMetricsInput(cachePrewarm),
    );

    const highlights = buildCachePrewarmSummaryHighlights(context);

    expect(context.severity.cachePrewarm).toBe('warning');
    expect(highlights).toEqual([
      expect.objectContaining({
        domain: 'cachePrewarm',
        severity: 'warning',
        code: 'CACHE_PREWARM_INVALID_KEYS_DETECTED',
        label: '缓存预热存在无效 Key',
        message: '发现 2 个无效 Key 被跳过。',
        actionId: 'open_cache_prewarm_recent_cycles',
      }),
    ]);
  });

  it('buildCachePrewarmSummaryHighlights 会为失败场景生成 failure 高亮', () => {
    const cachePrewarm = createCachePrewarmSnapshot({
      totalCycles: 2,
      failedCount: 1,
      recentCycles: [
        createCycleSnapshot({
          cycleId: 2,
          failedCount: 1,
          slowKeySamples: [
            {
              category: 'dashboardHome',
              cacheKey: 'profit:dashboard:home:store:18:period:today',
              durationMs: 160,
              status: 'failed',
              errorTag: 'Error',
              failedReason: 'boom',
            },
          ],
          failedKeyCountByCategory: {
            dashboardHome: 1,
            businessAnalysis: 0,
            financeOverview: 0,
          },
        }),
      ],
      failedReasonTopNByCategory: [
        {
          category: 'dashboardHome',
          failedCount: 1,
          topReasons: [
            {
              errorTag: 'Error',
              failedReason: 'boom',
              count: 1,
            },
          ],
        },
        {
          category: 'businessAnalysis',
          failedCount: 0,
          topReasons: [],
        },
        {
          category: 'financeOverview',
          failedCount: 0,
          topReasons: [],
        },
      ],
      lastFailedAtByCategory: {
        dashboardHome: '2026-06-08T10:04:00.000Z',
        businessAnalysis: null,
        financeOverview: null,
      },
      lastFailedKeyByCategory: {
        dashboardHome: 'profit:dashboard:home:store:18:period:today',
        businessAnalysis: null,
        financeOverview: null,
      },
      lastFailedSampleByCategory: {
        dashboardHome: {
          capturedAt: '2026-06-08T10:04:00.000Z',
          cacheKey: 'profit:dashboard:home:store:18:period:today',
          durationMs: 160,
          errorTag: 'Error',
          failedReason: 'boom',
        },
        businessAnalysis: null,
        financeOverview: null,
      },
    });
    const context = buildMetricsSummaryContext(
      createSummaryMetricsInput(cachePrewarm),
    );

    const highlights = buildCachePrewarmSummaryHighlights(context);

    expect(context.severity.cachePrewarm).toBe('critical');
    expect(highlights).toEqual([
      expect.objectContaining({
        domain: 'cachePrewarm',
        severity: 'critical',
        code: 'CACHE_PREWARM_FAILURES_DETECTED',
        label: '缓存预热异常',
        message: expect.stringContaining('累计失败 1 次'),
        actionId: 'open_cache_prewarm_failed_samples',
      }),
    ]);
  });
});
