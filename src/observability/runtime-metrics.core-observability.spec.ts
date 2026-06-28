import {
  getRuntimeMetricsSnapshot,
  recordHttpRequest,
  recordRedisOperation,
  resetRuntimeMetrics,
} from './runtime-metrics';
import { buildHttpActionMeta } from './runtime-metrics.summary-context-actions-http';
import { buildProcessActionMeta } from './runtime-metrics.summary-context-actions-process';
import { buildRedisActionMeta } from './runtime-metrics.summary-context-actions-redis';
import { buildSqlActionMeta } from './runtime-metrics.summary-context-actions-sql';
import { buildMetricsSummaryContext } from './runtime-metrics.summary-context';
import { buildHttpSummaryHighlights } from './runtime-metrics.summary-highlights-http';
import { buildProcessSummaryHighlights } from './runtime-metrics.summary-highlights-process';
import { buildRedisSummaryHighlights } from './runtime-metrics.summary-highlights-redis';
import { buildSqlSummaryHighlights } from './runtime-metrics.summary-highlights-sql';
import type { SummaryMetricsInput } from './runtime-metrics.summary-context.types';

function createBaseInput(): SummaryMetricsInput {
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
    cachePrewarm: {
      totalCycles: 0,
      avgDurationMs: 0,
      maxDurationMs: 0,
      hitCount: 0,
      refreshedCount: 0,
      skippedCount: 0,
      invalidCount: 0,
      failedCount: 0,
      lastDurationMs: 0,
      lastSeenAt: null,
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
        {
          category: 'marketingOverview',
          failedCount: 0,
          topReasons: [],
        },
        {
          category: 'membersMeta',
          failedCount: 0,
          topReasons: [],
        },
        {
          category: 'membersOverview',
          failedCount: 0,
          topReasons: [],
        },
      ],
      lastFailedAtByCategory: {
        dashboardHome: null,
        businessAnalysis: null,
        financeOverview: null,
        marketingOverview: null,
        membersMeta: null,
        membersOverview: null,
        financeReport: null,
        profitDetail: null,
        profitReport: null,
        costsStats: null,
        costsReport: null,
      },
      lastFailedKeyByCategory: {
        dashboardHome: null,
        businessAnalysis: null,
        financeOverview: null,
        marketingOverview: null,
        membersMeta: null,
        membersOverview: null,
        financeReport: null,
        profitDetail: null,
        profitReport: null,
        costsStats: null,
        costsReport: null,
      },
      lastFailedSampleByCategory: {
        dashboardHome: null,
        businessAnalysis: null,
        financeOverview: null,
        marketingOverview: null,
        membersMeta: null,
        membersOverview: null,
        financeReport: null,
        profitDetail: null,
        profitReport: null,
        costsStats: null,
        costsReport: null,
      },
      recentCycles: [],
    },
  };
}

describe('core observability helpers', () => {
  beforeEach(() => {
    resetRuntimeMetrics();
  });

  it('buildProcessActionMeta 在 CPU 压力场景会指向 cpu 面板', () => {
    const input: SummaryMetricsInput = {
      ...createBaseInput(),
      process: {
        ...createBaseInput().process,
        approxCpuUtilizationPercent: 72,
      },
    };

    const actionMeta = buildProcessActionMeta(input, 'warning', 50);

    expect(actionMeta).toMatchObject({
      actionId: 'open_process_resource_panel',
      actionText: '查看进程资源',
      actionParams: {
        section: 'process',
        focus: 'cpu',
        severity: 'warning',
      },
      actionPayload: {
        section: 'process',
        panel: 'process.resource_overview',
        tab: 'process.cpu',
        metric: 'process.cpu_utilization',
        focus: 'cpu',
        severity: 'warning',
      },
      ownerType: 'backend_oncall',
      impactScope: 'instance',
    });
  });

  it('buildProcessSummaryHighlights 会命中 heap 分支', () => {
    const input: SummaryMetricsInput = {
      ...createBaseInput(),
      process: {
        ...createBaseInput().process,
        heapUsedMb: 80,
        heapTotalMb: 100,
      },
    };

    const context = buildMetricsSummaryContext(input);
    const highlights = buildProcessSummaryHighlights(context);

    expect(context.severity.process).toBe('warning');
    expect(highlights).toEqual([
      expect.objectContaining({
        domain: 'process',
        severity: 'warning',
        code: 'PROCESS_HEAP_PRESSURE',
        label: '进程堆内存压力升高',
        actionParams: expect.objectContaining({
          focus: 'heap',
        }),
      }),
    ]);
  });

  it('buildProcessSummaryHighlights 会命中 rss 分支', () => {
    const input: SummaryMetricsInput = {
      ...createBaseInput(),
      process: {
        ...createBaseInput().process,
        rssMb: 800,
        heapUsedMb: 30,
        heapTotalMb: 100,
      },
    };

    const context = buildMetricsSummaryContext(input);
    const highlights = buildProcessSummaryHighlights(context);

    expect(context.severity.process).toBe('warning');
    expect(highlights).toEqual([
      expect.objectContaining({
        domain: 'process',
        severity: 'warning',
        code: 'PROCESS_RSS_PRESSURE',
        label: '进程常驻内存偏高',
        actionParams: expect.objectContaining({
          focus: 'rss',
        }),
      }),
    ]);
  });

  it('buildHttpActionMeta 在错误率场景会指向异常路由', () => {
    const input: SummaryMetricsInput = {
      ...createBaseInput(),
      http: {
        ...createBaseInput().http,
        totalRequests: 10,
        errorRequests: 2,
        maxDurationMs: 320,
        topRoutes: [
          {
            method: 'GET',
            route: '/api/orders',
            totalRequests: 10,
            errorRequests: 2,
            slowRequests: 1,
            totalDurationMs: 620,
            avgDurationMs: 62,
            maxDurationMs: 320,
            errorRatePercent: 20,
            lastStatusCode: 500,
            lastDurationMs: 320,
            lastSeenAt: '2026-06-08T10:02:00.000Z',
          },
        ],
      },
    };

    const actionMeta = buildHttpActionMeta(input, 'critical', 20);

    expect(actionMeta).toMatchObject({
      actionId: 'open_http_top_routes',
      actionText: '查看异常路由',
      actionParams: {
        section: 'http',
        tab: 'topRoutes',
        route: '/api/orders',
      },
      actionPayload: {
        section: 'http',
        panel: 'http.request_diagnostics',
        tab: 'http.top_routes',
        metric: 'http.error_rate',
        route: '/api/orders',
      },
      eta: '15 分钟内',
      impactLevel: 'urgent',
    });
  });

  it('buildHttpSummaryHighlights 会命中 latency 分支', () => {
    recordHttpRequest({
      method: 'GET',
      route: '/api/reports',
      statusCode: 200,
      durationMs: 920,
      requestId: 'req-1',
      slowThresholdMs: 300,
    });
    for (let index = 2; index <= 10; index += 1) {
      recordHttpRequest({
        method: 'GET',
        route: '/api/reports',
        statusCode: 200,
        durationMs: 80,
        requestId: `req-${index}`,
        slowThresholdMs: 300,
      });
    }

    const snapshot = getRuntimeMetricsSnapshot();
    const context = buildMetricsSummaryContext({
      ...createBaseInput(),
      generatedAt: snapshot.generatedAt,
      http: snapshot.http,
    });
    const highlights = buildHttpSummaryHighlights(context);

    expect(context.severity.http).toBe('warning');
    expect(highlights).toEqual([
      expect.objectContaining({
        domain: 'http',
        severity: 'warning',
        code: 'HTTP_LATENCY_HIGH',
        label: '接口耗时升高',
        actionId: 'open_http_slow_requests',
        message: expect.stringContaining('当前慢请求 1 个'),
      }),
    ]);
  });

  it('buildSqlActionMeta 会带出 top operation', () => {
    const input: SummaryMetricsInput = {
      ...createBaseInput(),
      sql: {
        ...createBaseInput().sql,
        totalQueries: 4,
        slowQueries: 2,
        maxDurationMs: 1200,
        byOperation: [
          {
            operation: 'SELECT',
            totalQueries: 3,
            avgDurationMs: 200,
            totalDurationMs: 600,
          },
        ],
      },
    };

    const actionMeta = buildSqlActionMeta(input, 'critical');

    expect(actionMeta).toMatchObject({
      actionId: 'open_sql_slow_queries',
      actionText: '查看慢 SQL',
      actionParams: {
        section: 'sql',
        tab: 'slowQueries',
        operation: 'SELECT',
      },
      actionPayload: {
        section: 'sql',
        panel: 'sql.query_diagnostics',
        tab: 'sql.slow_queries',
        metric: 'sql.slow_query_rate',
        operation: 'SELECT',
      },
      ownerType: 'dba_owner',
    });
  });

  it('buildSqlSummaryHighlights 会生成慢查询告警', () => {
    const input: SummaryMetricsInput = {
      ...createBaseInput(),
      sql: {
        ...createBaseInput().sql,
        totalQueries: 4,
        slowQueries: 2,
        maxDurationMs: 1200,
        recentSlowQueries: [
          {
            durationMs: 1200,
            operation: 'SELECT',
            target: 'postgres',
            queryPreview: 'SELECT * FROM orders',
            capturedAt: '2026-06-08T10:03:00.000Z',
          },
        ],
      },
    };

    const context = buildMetricsSummaryContext(input);
    const highlights = buildSqlSummaryHighlights(context);

    expect(context.severity.sql).toBe('critical');
    expect(highlights).toEqual([
      expect.objectContaining({
        domain: 'sql',
        severity: 'critical',
        code: 'SQL_SLOW_QUERY_RATE_HIGH',
        label: '数据库查询偏慢',
        message: '慢查询率 50%，最大耗时 1200ms。',
      }),
    ]);
  });

  it('buildRedisActionMeta 在低命中率场景会指向命中率明细', () => {
    const input: SummaryMetricsInput = {
      ...createBaseInput(),
      redis: {
        ...createBaseInput().redis,
        totalCalls: 10,
        maxDurationMs: 30,
        commands: [
          {
            command: 'GET',
            totalCalls: 10,
            hitCount: 4,
            missCount: 6,
            slowCalls: 0,
            totalDurationMs: 90,
            avgDurationMs: 9,
            maxDurationMs: 30,
            hitRatePercent: 40,
            lastDurationMs: 8,
            lastSeenAt: '2026-06-08T10:04:00.000Z',
          },
        ],
      },
    };

    const actionMeta = buildRedisActionMeta(input, 'critical', 10, 40);

    expect(actionMeta).toMatchObject({
      actionId: 'open_redis_commands',
      actionText: '查看命中率明细',
      actionParams: {
        section: 'redis',
        tab: 'commands',
        command: 'GET',
      },
      actionPayload: {
        section: 'redis',
        panel: 'redis.cache_diagnostics',
        tab: 'redis.commands',
        metric: 'redis.hit_rate',
        command: 'GET',
      },
      ownerType: 'cache_owner',
    });
  });

  it('buildRedisSummaryHighlights 会命中 slow operations 分支', () => {
    recordRedisOperation({
      command: 'GET',
      durationMs: 90,
      outcome: 'neutral',
      slowThresholdMs: 30,
    });

    const snapshot = getRuntimeMetricsSnapshot();
    const context = buildMetricsSummaryContext({
      ...createBaseInput(),
      generatedAt: snapshot.generatedAt,
      redis: snapshot.redis,
    });
    const highlights = buildRedisSummaryHighlights(context);

    expect(context.severity.redis).toBe('warning');
    expect(highlights).toEqual([
      expect.objectContaining({
        domain: 'redis',
        severity: 'warning',
        code: 'REDIS_SLOW_OPERATIONS_HIGH',
        label: 'Redis 慢操作偏多',
        actionId: 'open_redis_slow_operations',
        message: '已观测到 1 次慢操作，峰值耗时 90ms。',
      }),
    ]);
  });
});
