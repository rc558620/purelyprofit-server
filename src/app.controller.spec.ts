import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import {
  recordCachePrewarmCycle,
  recordHttpRequest,
  recordRedisOperation,
  recordSqlQuery,
  resetRuntimeMetrics,
} from './observability';
import {
  SUMMARY_ACTION_TARGETS,
  SUMMARY_ACTION_TEXT_MODE,
  SUMMARY_ACTION_VERSION,
  SUMMARY_PROTOCOL_VERSION,
} from './observability';
import type {
  HealthSnapshot,
  MetricsSnapshot,
  ReadinessSnapshot,
} from './observability';
import { PrismaService } from './prisma/prisma.service';
import { RedisService } from './redis/redis.service';

describe('AppController', () => {
  let appController: AppController;

  const prismaService = {
    checkReadiness: jest.fn().mockResolvedValue(undefined),
  };
  const redisService = {
    checkReadiness: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    resetRuntimeMetrics();
    prismaService.checkReadiness.mockResolvedValue(undefined);
    redisService.checkReadiness.mockResolvedValue(undefined);

    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        { provide: PrismaService, useValue: prismaService },
        { provide: RedisService, useValue: redisService },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });

    it('should expose runtime metrics snapshot', () => {
      const metrics: MetricsSnapshot = appController.getMetrics();

      expect(metrics).toHaveProperty('summary');
      expect(metrics).toHaveProperty('http');
      expect(metrics).toHaveProperty('sql');
      expect(metrics).toHaveProperty('redis');
      expect(metrics).toHaveProperty('cachePrewarm');
    });

    it('should expose typed health snapshot', () => {
      const health: HealthSnapshot = appController.getHealth();

      expect(health).toMatchObject({
        status: 'ok',
        generatedAt: expect.any(String),
        process: {
          pid: expect.any(Number),
          nodeVersion: expect.any(String),
          uptimeSeconds: expect.any(Number),
          cpuUsedMs: expect.any(Number),
          approxCpuUtilizationPercent: expect.any(Number),
          rssMb: expect.any(Number),
          heapUsedMb: expect.any(Number),
          heapTotalMb: expect.any(Number),
          externalMb: expect.any(Number),
        },
        counters: {
          httpRequests: 0,
          sqlQueries: 0,
          redisCalls: 0,
        },
      });
    });

    it('should expose readiness snapshot', async () => {
      const readiness: ReadinessSnapshot = await appController.getReadiness();

      expect(readiness).toMatchObject({
        status: 'ok',
        generatedAt: expect.any(String),
        dependencies: [
          {
            name: 'database',
            status: 'up',
            latencyMs: expect.any(Number),
          },
          {
            name: 'redis',
            status: 'up',
            latencyMs: expect.any(Number),
          },
        ],
      });
    });

    it('should expose dashboard friendly summary view', () => {
      recordHttpRequest({
        method: 'GET',
        route: '/api/demo',
        statusCode: 500,
        durationMs: 120,
        requestId: 'req-1',
        slowThresholdMs: 100,
      });
      recordHttpRequest({
        method: 'GET',
        route: '/api/demo',
        statusCode: 200,
        durationMs: 30,
        requestId: 'req-2',
        slowThresholdMs: 100,
      });
      recordSqlQuery({
        query: 'SELECT 1',
        durationMs: 120,
        slowThresholdMs: 100,
      });
      recordRedisOperation({
        command: 'GET',
        durationMs: 40,
        outcome: 'hit',
        slowThresholdMs: 30,
      });
      recordRedisOperation({
        command: 'GET',
        durationMs: 10,
        outcome: 'miss',
        slowThresholdMs: 30,
      });
      recordCachePrewarmCycle({
        durationMs: 210,
        hitCount: 3,
        refreshedCount: 2,
        skippedCount: 1,
        invalidCount: 1,
        failedCount: 1,
        dashboardHitCount: 1,
        businessAnalysisHitCount: 1,
        financeOverviewHitCount: 1,
        marketingOverviewHitCount: 0,
        membersMetaHitCount: 0,
        membersOverviewHitCount: 0,
        failedKeyCountByCategory: {
          dashboardHome: 1,
          businessAnalysis: 0,
          financeOverview: 0,
          marketingOverview: 0,
          membersMeta: 0,
          membersOverview: 0,
        },
        slowestFailedReason: 'Error:boom',
        durationDistribution: {
          dashboardHome: {
            sampleCount: 1,
            totalDurationMs: 80,
            avgDurationMs: 80,
            minDurationMs: 80,
            maxDurationMs: 80,
            p50DurationMs: 80,
            p95DurationMs: 80,
          },
          businessAnalysis: {
            sampleCount: 1,
            totalDurationMs: 20,
            avgDurationMs: 20,
            minDurationMs: 20,
            maxDurationMs: 20,
            p50DurationMs: 20,
            p95DurationMs: 20,
          },
          financeOverview: {
            sampleCount: 1,
            totalDurationMs: 40,
            avgDurationMs: 40,
            minDurationMs: 40,
            maxDurationMs: 40,
            p50DurationMs: 40,
            p95DurationMs: 40,
          },
          marketingOverview: {
            sampleCount: 0,
            totalDurationMs: 0,
            avgDurationMs: 0,
            minDurationMs: 0,
            maxDurationMs: 0,
            p50DurationMs: 0,
            p95DurationMs: 0,
          },
          membersMeta: {
            sampleCount: 0,
            totalDurationMs: 0,
            avgDurationMs: 0,
            minDurationMs: 0,
            maxDurationMs: 0,
            p50DurationMs: 0,
            p95DurationMs: 0,
          },
          membersOverview: {
            sampleCount: 0,
            totalDurationMs: 0,
            avgDurationMs: 0,
            minDurationMs: 0,
            maxDurationMs: 0,
            p50DurationMs: 0,
            p95DurationMs: 0,
          },
        },
        slowKeySamples: [
          {
            category: 'dashboardHome',
            cacheKey: 'profit:dashboard:home:store:18:period:today',
            durationMs: 80,
            status: 'failed',
            errorTag: 'Error',
            failedReason: 'boom',
          },
          {
            category: 'financeOverview',
            cacheKey: 'profit:finance:overview:store:18:period:month',
            durationMs: 40,
            status: 'refreshed',
            errorTag: null,
            failedReason: null,
          },
        ],
      });

      const metrics = appController.getMetrics();

      expect(metrics.summary.protocolVersion).toBe(SUMMARY_PROTOCOL_VERSION);
      expect(metrics.summary.actionTextMode).toBe(SUMMARY_ACTION_TEXT_MODE);
      expect(metrics.summary.generatedAt).toBe(metrics.generatedAt);
      expect(metrics.summary.status).toBe('critical');
      expect(metrics.summary.severity).toEqual(
        expect.objectContaining({
          http: 'critical',
          sql: 'critical',
          redis: 'critical',
          cachePrewarm: 'critical',
        }),
      );
      expect(['healthy', 'warning', 'critical']).toContain(
        metrics.summary.severity.process,
      );
      expect(metrics.summary.highlights).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            domain: 'http',
            severity: 'critical',
            code: 'HTTP_ERROR_RATE_HIGH',
            label: '接口异常率升高',
            message: expect.stringContaining('5xx 错误率'),
          }),
          expect.objectContaining({
            domain: 'sql',
            severity: 'critical',
            code: 'SQL_SLOW_QUERY_RATE_HIGH',
            label: '数据库查询偏慢',
            message: expect.stringContaining('慢查询率'),
          }),
          expect.objectContaining({
            domain: 'redis',
            severity: 'critical',
            code: 'REDIS_HIT_RATE_LOW',
            label: 'Redis 命中率偏低',
            message: expect.stringContaining('当前命中率'),
          }),
          expect.objectContaining({
            domain: 'cachePrewarm',
            severity: 'critical',
            code: 'CACHE_PREWARM_FAILURES_DETECTED',
            label: '缓存预热异常',
            message: expect.stringContaining('累计失败'),
          }),
        ]),
      );
      expect(metrics.summary.topHighlights).toHaveLength(3);
      expect(metrics.summary.topHighlights[0]).toMatchObject({
        domain: 'cachePrewarm',
        code: 'CACHE_PREWARM_FAILURES_DETECTED',
        label: '缓存预热异常',
        actionId: 'open_cache_prewarm_failed_samples',
        actionVersion: SUMMARY_ACTION_VERSION,
        actionType: 'drawer',
        actionText: '查看预热失败样本',
        actionTextMode: SUMMARY_ACTION_TEXT_MODE,
        actionTarget: SUMMARY_ACTION_TARGETS.open_cache_prewarm_failed_samples,
        actionParams: {
          section: 'cachePrewarm',
          tab: 'failedSamples',
          category: 'dashboardHome',
        },
        actionPayload: expect.objectContaining({
          panel: 'cache_prewarm.diagnostics',
          tab: 'cache_prewarm.failed_samples',
          metric: 'cache_prewarm.failure_rate',
        }),
        owner: '缓存预热负责人',
        ownerType: 'prewarm_owner',
        responsibleTeam: '后端 API 团队',
        eta: '15 分钟内',
        impactLevel: 'urgent',
        impactScope: 'cache_prewarm',
      });
      expect(metrics.summary.topHighlights[1]).toMatchObject({
        domain: 'http',
        code: 'HTTP_ERROR_RATE_HIGH',
        label: '接口异常率升高',
        actionId: 'open_http_top_routes',
        actionVersion: SUMMARY_ACTION_VERSION,
        actionType: 'drawer',
        actionText: '查看异常路由',
        actionTextMode: SUMMARY_ACTION_TEXT_MODE,
        actionTarget: SUMMARY_ACTION_TARGETS.open_http_top_routes,
        actionParams: {
          section: 'http',
          tab: 'topRoutes',
          route: '/api/demo',
        },
        actionPayload: expect.objectContaining({
          panel: 'http.request_diagnostics',
          tab: 'http.top_routes',
          metric: 'http.error_rate',
        }),
        owner: '接口值班',
        ownerType: 'api_owner',
        responsibleTeam: '后端 API 团队',
        eta: '15 分钟内',
        impactLevel: 'urgent',
        impactScope: 'route',
      });
      expect(metrics.summary.topHighlights[2]).toMatchObject({
        domain: 'sql',
        code: 'SQL_SLOW_QUERY_RATE_HIGH',
        label: '数据库查询偏慢',
        actionId: 'open_sql_slow_queries',
        actionVersion: SUMMARY_ACTION_VERSION,
        actionType: 'drawer',
        actionText: '查看慢 SQL',
        actionTextMode: SUMMARY_ACTION_TEXT_MODE,
        actionTarget: SUMMARY_ACTION_TARGETS.open_sql_slow_queries,
        actionParams: {
          section: 'sql',
          tab: 'slowQueries',
          operation: 'SELECT',
        },
        actionPayload: expect.objectContaining({
          panel: 'sql.query_diagnostics',
          tab: 'sql.slow_queries',
          metric: 'sql.slow_query_rate',
          operation: 'SELECT',
        }),
        owner: '数据查询负责人',
        ownerType: 'dba_owner',
        responsibleTeam: '后端 API / DBA',
        eta: '30 分钟内',
        impactLevel: 'high',
        impactScope: 'database',
      });
      expect(metrics.summary.overview).toMatchObject({
        totalRequests: 2,
        totalQueries: 1,
        totalRedisCalls: 2,
        totalPrewarmCycles: 1,
      });
      expect(metrics.summary.process).toMatchObject({
        severity: metrics.summary.severity.process,
        trend: expect.stringMatching(/stable|watch|degrading/),
        label: expect.any(String),
        message: expect.any(String),
        suggestion: expect.any(String),
        actionId: 'open_process_resource_panel',
        actionVersion: SUMMARY_ACTION_VERSION,
        actionType: 'drawer',
        actionText: '查看进程资源',
        actionTextMode: SUMMARY_ACTION_TEXT_MODE,
        actionTarget: SUMMARY_ACTION_TARGETS.open_process_resource_panel,
        actionParams: expect.objectContaining({
          section: 'process',
          focus: expect.stringMatching(/cpu|heap|rss/),
          severity: expect.stringMatching(/healthy|warning|critical/),
        }),
        actionPayload: expect.objectContaining({
          panel: 'process.resource_overview',
          tab: expect.stringMatching(/^process\./),
          metric: expect.stringMatching(/^process\./),
          section: 'process',
        }),
        owner: '后端值班',
        ownerType: 'backend_oncall',
        responsibleTeam: '基础设施团队',
        eta: expect.any(String),
        impactLevel: expect.stringMatching(/low|medium|high|urgent/),
        impactScope: 'instance',
        memoryPressurePercent: expect.any(Number),
      });
      expect(metrics.summary.http).toMatchObject({
        severity: 'critical',
        trend: 'degrading',
        label: '接口异常',
        message: expect.stringContaining('5xx 错误率'),
        suggestion: expect.stringContaining('http.topRoutes'),
        actionId: 'open_http_top_routes',
        actionVersion: SUMMARY_ACTION_VERSION,
        actionType: 'drawer',
        actionText: '查看异常路由',
        actionTextMode: SUMMARY_ACTION_TEXT_MODE,
        actionTarget: SUMMARY_ACTION_TARGETS.open_http_top_routes,
        actionParams: {
          section: 'http',
          tab: 'topRoutes',
          route: '/api/demo',
        },
        actionPayload: expect.objectContaining({
          panel: 'http.request_diagnostics',
          tab: 'http.top_routes',
          metric: 'http.error_rate',
        }),
        owner: '接口值班',
        ownerType: 'api_owner',
        responsibleTeam: '后端 API 团队',
        eta: '15 分钟内',
        impactLevel: 'urgent',
        impactScope: 'route',
        totalRequests: 2,
        errorRequests: 1,
        errorRatePercent: 50,
        avgDurationMs: 75,
        maxDurationMs: 120,
        slowRequestCount: 1,
        slowRequestRatePercent: 50,
        topRoute: expect.objectContaining({
          route: '/api/demo',
          totalRequests: 2,
        }),
      });
      expect(metrics.summary.sql).toMatchObject({
        severity: 'critical',
        trend: 'degrading',
        label: '数据库查询偏慢',
        message: expect.stringContaining('慢查询率'),
        suggestion: expect.stringContaining('sql.recentSlowQueries'),
        actionId: 'open_sql_slow_queries',
        actionVersion: SUMMARY_ACTION_VERSION,
        actionType: 'drawer',
        actionText: '查看慢 SQL',
        actionTextMode: SUMMARY_ACTION_TEXT_MODE,
        actionTarget: SUMMARY_ACTION_TARGETS.open_sql_slow_queries,
        actionParams: {
          section: 'sql',
          tab: 'slowQueries',
          operation: 'SELECT',
        },
        actionPayload: expect.objectContaining({
          panel: 'sql.query_diagnostics',
          tab: 'sql.slow_queries',
          metric: 'sql.slow_query_rate',
          operation: 'SELECT',
        }),
        owner: '数据查询负责人',
        ownerType: 'dba_owner',
        responsibleTeam: '后端 API / DBA',
        eta: '30 分钟内',
        impactLevel: 'high',
        impactScope: 'database',
        totalQueries: 1,
        slowQueries: 1,
        slowQueryRatePercent: 100,
        avgDurationMs: 120,
        maxDurationMs: 120,
        topOperation: expect.objectContaining({
          operation: 'SELECT',
          totalQueries: 1,
        }),
      });
      expect(metrics.summary.redis).toMatchObject({
        severity: 'critical',
        trend: 'degrading',
        label: 'Redis 命中率偏低',
        message: expect.stringContaining('当前命中率'),
        suggestion: expect.stringContaining('redis.commands'),
        actionId: 'open_redis_commands',
        actionVersion: SUMMARY_ACTION_VERSION,
        actionType: 'drawer',
        actionText: '查看命中率明细',
        actionTextMode: SUMMARY_ACTION_TEXT_MODE,
        actionTarget: SUMMARY_ACTION_TARGETS.open_redis_commands,
        actionParams: {
          section: 'redis',
          tab: 'commands',
          command: 'GET',
        },
        actionPayload: expect.objectContaining({
          panel: 'redis.cache_diagnostics',
          tab: 'redis.commands',
          metric: 'redis.hit_rate',
        }),
        owner: '缓存负责人',
        ownerType: 'cache_owner',
        responsibleTeam: '缓存中间件团队',
        eta: '30 分钟内',
        impactLevel: 'high',
        impactScope: 'cache',
        totalCalls: 2,
        avgDurationMs: 25,
        maxDurationMs: 40,
        slowOperationCount: 1,
        overallHitRatePercent: 50,
        topCommand: expect.objectContaining({
          command: 'GET',
          totalCalls: 2,
        }),
      });
      expect(metrics.summary.cachePrewarm).toMatchObject({
        severity: 'critical',
        trend: 'degrading',
        label: '缓存预热异常',
        message: expect.stringContaining('累计失败'),
        suggestion: expect.stringContaining('cachePrewarm.recentCycles'),
        actionId: 'open_cache_prewarm_failed_samples',
        actionVersion: SUMMARY_ACTION_VERSION,
        actionType: 'drawer',
        actionText: '查看预热失败样本',
        actionTextMode: SUMMARY_ACTION_TEXT_MODE,
        actionTarget: SUMMARY_ACTION_TARGETS.open_cache_prewarm_failed_samples,
        actionParams: {
          section: 'cachePrewarm',
          tab: 'failedSamples',
          category: 'dashboardHome',
        },
        actionPayload: expect.objectContaining({
          panel: 'cache_prewarm.diagnostics',
          tab: 'cache_prewarm.failed_samples',
          metric: 'cache_prewarm.failure_rate',
          category: 'dashboardHome',
        }),
        owner: '缓存预热负责人',
        ownerType: 'prewarm_owner',
        responsibleTeam: '后端 API 团队',
        eta: '15 分钟内',
        impactLevel: 'urgent',
        impactScope: 'cache_prewarm',
        totalCycles: 1,
        totalKeys: 8,
        failedCount: 1,
        invalidCount: 1,
        failureRatePercent: 12.5,
        avgDurationMs: 210,
        maxDurationMs: 210,
        lastDurationMs: 210,
        hottestCategoryByP95: {
          category: 'dashboardHome',
          sampleCount: 1,
          avgDurationMs: 80,
          p95DurationMs: 80,
          maxDurationMs: 80,
        },
        mostFailedCategory: {
          category: 'dashboardHome',
          failedCount: 1,
          topReason: {
            errorTag: 'Error',
            failedReason: 'boom',
            count: 1,
          },
          lastFailedKey: 'profit:dashboard:home:store:18:period:today',
          lastFailedSample: {
            capturedAt: expect.any(String),
            cacheKey: 'profit:dashboard:home:store:18:period:today',
            durationMs: 80,
            errorTag: 'Error',
            failedReason: 'boom',
          },
        },
        latestFailedCategory: {
          category: 'dashboardHome',
          lastFailedAt: expect.any(String),
          lastFailedKey: 'profit:dashboard:home:store:18:period:today',
          lastFailedSample: {
            capturedAt: expect.any(String),
            cacheKey: 'profit:dashboard:home:store:18:period:today',
            durationMs: 80,
            errorTag: 'Error',
            failedReason: 'boom',
          },
        },
        topFailedReason: {
          errorTag: 'Error',
          failedReason: 'boom',
          count: 1,
        },
      });
    });
  });
});
