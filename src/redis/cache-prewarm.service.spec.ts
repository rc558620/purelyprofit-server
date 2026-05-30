import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import {
  getRuntimeMetricsSnapshot,
  resetRuntimeMetrics,
} from '../observability';
import { BusinessAnalysisService } from '../purely-profit/dashboard/business-analysis/business-analysis.service';
import { DashboardHomeService } from '../purely-profit/dashboard/dashboard-home/dashboard-home.service';
import { FinanceOverviewService } from '../purely-profit/finance/finance-overview.service';
import { CachePrewarmService } from './cache-prewarm.service';
import { RedisService } from './redis.service';

describe('CachePrewarmService', () => {
  let service: CachePrewarmService;

  const configService = {
    get: jest.fn((key: string) => {
      const configMap: Record<string, number | boolean> = {
        'app.cachePrewarmEnabled': true,
        'app.cachePrewarmIntervalMs': 60_000,
        'app.cachePrewarmInitialDelayMs': 1_000,
        'app.cachePrewarmBatchSize': 10,
        'app.cachePrewarmConcurrency': 2,
        'app.cachePrewarmLogEnabled': true,
        'app.cachePrewarmLogSampleEvery': 20,
        'app.cachePrewarmSlowCycleThresholdMs': 1_500,
      };
      return configMap[key];
    }),
  };

  const redisService = {
    scanKeysByPattern: jest.fn(),
  };

  const dashboardHomeService = {
    warmOverviewCache: jest.fn().mockResolvedValue(undefined),
  };

  const businessAnalysisService = {
    warmAnalysisCache: jest.fn().mockResolvedValue(undefined),
  };

  const financeOverviewService = {
    warmOverviewCache: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    resetRuntimeMetrics();
    jest.useFakeTimers();
    jest.clearAllMocks();
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CachePrewarmService,
        { provide: ConfigService, useValue: configService },
        { provide: RedisService, useValue: redisService },
        { provide: DashboardHomeService, useValue: dashboardHomeService },
        { provide: BusinessAnalysisService, useValue: businessAnalysisService },
        { provide: FinanceOverviewService, useValue: financeOverviewService },
      ],
    }).compile();

    service = module.get<CachePrewarmService>(CachePrewarmService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
    service.onModuleDestroy();
  });

  it('会按周期扫描热点缓存并触发预热', async () => {
    dashboardHomeService.warmOverviewCache.mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(resolve, 30)),
    );
    businessAnalysisService.warmAnalysisCache.mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(resolve, 20)),
    );
    financeOverviewService.warmOverviewCache.mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(resolve, 10)),
    );
    redisService.scanKeysByPattern
      .mockResolvedValueOnce(['profit:dashboard:home:store:18:period:today'])
      .mockResolvedValueOnce([
        'profit:business-analysis:store:18:period:month:start:na:end:na',
      ])
      .mockResolvedValueOnce(['profit:finance:overview:store:18:period:month']);

    service.onModuleInit();
    await jest.advanceTimersByTimeAsync(1_100);

    expect(redisService.scanKeysByPattern).toHaveBeenCalledTimes(3);
    expect(dashboardHomeService.warmOverviewCache).toHaveBeenCalledWith(
      18,
      'today',
    );
    expect(businessAnalysisService.warmAnalysisCache).toHaveBeenCalledWith(18, {
      period: 'month',
      startTime: undefined,
      endTime: undefined,
    });
    expect(financeOverviewService.warmOverviewCache).toHaveBeenCalledWith(
      18,
      'month',
    );

    const metrics = getRuntimeMetricsSnapshot();
    expect(metrics.cachePrewarm.totalCycles).toBeGreaterThanOrEqual(1);
    expect(metrics.cachePrewarm.hitCount).toBeGreaterThanOrEqual(3);
    expect(metrics.cachePrewarm.refreshedCount).toBeGreaterThanOrEqual(3);
    expect(metrics.cachePrewarm.failedCount).toBe(0);
    expect(
      metrics.cachePrewarm.recentCycles[0]?.durationDistribution.dashboardHome,
    ).toMatchObject({
      sampleCount: 1,
      p50DurationMs: expect.any(Number),
      p95DurationMs: expect.any(Number),
    });
    expect(
      metrics.cachePrewarm.recentCycles[0]?.durationDistribution
        .businessAnalysis,
    ).toMatchObject({
      sampleCount: 1,
      p50DurationMs: expect.any(Number),
      p95DurationMs: expect.any(Number),
    });
    expect(
      metrics.cachePrewarm.recentCycles[0]?.durationDistribution
        .financeOverview,
    ).toMatchObject({
      sampleCount: 1,
      p50DurationMs: expect.any(Number),
      p95DurationMs: expect.any(Number),
    });
    expect(metrics.cachePrewarm.failedReasonTopN).toEqual([]);
    expect(metrics.cachePrewarm.failedReasonTopNByCategory).toEqual([
      { category: 'businessAnalysis', failedCount: 0, topReasons: [] },
      { category: 'dashboardHome', failedCount: 0, topReasons: [] },
      { category: 'financeOverview', failedCount: 0, topReasons: [] },
    ]);
    expect(metrics.cachePrewarm.lastFailedAtByCategory).toEqual({
      dashboardHome: null,
      businessAnalysis: null,
      financeOverview: null,
    });
    expect(metrics.cachePrewarm.lastFailedKeyByCategory).toEqual({
      dashboardHome: null,
      businessAnalysis: null,
      financeOverview: null,
    });
    expect(metrics.cachePrewarm.lastFailedSampleByCategory).toEqual({
      dashboardHome: null,
      businessAnalysis: null,
      financeOverview: null,
    });
    expect(
      metrics.cachePrewarm.recentCycles[0]?.failedKeyCountByCategory,
    ).toEqual({
      dashboardHome: 0,
      businessAnalysis: 0,
      financeOverview: 0,
    });
    expect(
      metrics.cachePrewarm.recentCycles[0]?.slowestFailedReason,
    ).toBeNull();
    expect(metrics.cachePrewarm.recentCycles[0]?.slowKeySamples).toEqual([
      {
        category: 'dashboardHome',
        cacheKey: 'profit:dashboard:home:store:18:period:today',
        durationMs: 30,
        status: 'refreshed',
        errorTag: null,
        failedReason: null,
      },
      {
        category: 'businessAnalysis',
        cacheKey:
          'profit:business-analysis:store:18:period:month:start:na:end:na',
        durationMs: 20,
        status: 'refreshed',
        errorTag: null,
        failedReason: null,
      },
      {
        category: 'financeOverview',
        cacheKey: 'profit:finance:overview:store:18:period:month',
        durationMs: 10,
        status: 'refreshed',
        errorTag: null,
        failedReason: null,
      },
    ]);
  });

  it('预热失败或异常时会记录日志采样', async () => {
    redisService.scanKeysByPattern
      .mockResolvedValueOnce(['profit:dashboard:home:store:18:period:today'])
      .mockResolvedValueOnce([
        'profit:business-analysis:store:18:period:invalid:start:na:end:na',
      ])
      .mockResolvedValueOnce(['profit:finance:overview:store:18:period:month']);
    dashboardHomeService.warmOverviewCache.mockRejectedValueOnce(
      new Error('boom'),
    );

    service.onModuleInit();
    await jest.advanceTimersByTimeAsync(1_000);

    expect(console.info).toHaveBeenCalledWith(
      expect.stringContaining(
        'failedKeyCountByCategory=dashboardHome:1,businessAnalysis:0,financeOverview:0',
      ),
    );
    expect(console.info).toHaveBeenCalledWith(
      expect.stringContaining('slowestFailedErrorTag=Error'),
    );
    expect(console.info).toHaveBeenCalledWith(
      expect.stringContaining('slowestFailedReason=boom'),
    );
    expect(console.warn).toHaveBeenCalledWith(
      '[cache-prewarm] refresh failed',
      expect.objectContaining({
        durationMs: expect.any(Number),
        category: 'dashboardHome',
        cacheKey: 'profit:dashboard:home:store:18:period:today',
        status: 'failed',
        errorTag: 'Error',
        failedReason: 'boom',
      }),
    );

    const metrics = getRuntimeMetricsSnapshot();
    expect(metrics.cachePrewarm.invalidCount).toBeGreaterThanOrEqual(1);
    expect(metrics.cachePrewarm.failedCount).toBeGreaterThanOrEqual(1);
    expect(
      metrics.cachePrewarm.recentCycles[0]?.durationDistribution.dashboardHome,
    ).toMatchObject({
      sampleCount: 1,
      p50DurationMs: expect.any(Number),
      p95DurationMs: expect.any(Number),
    });
    expect(
      metrics.cachePrewarm.recentCycles[0]?.durationDistribution
        .businessAnalysis,
    ).toMatchObject({
      sampleCount: 0,
      p50DurationMs: 0,
      p95DurationMs: 0,
    });
    expect(metrics.cachePrewarm.failedReasonTopN).toEqual(
      expect.arrayContaining([
        {
          errorTag: 'Error',
          failedReason: 'boom',
          count: 1,
        },
      ]),
    );
    expect(metrics.cachePrewarm.failedReasonTopNByCategory[0]).toEqual({
      category: 'dashboardHome',
      failedCount: 1,
      topReasons: [
        {
          errorTag: 'Error',
          failedReason: 'boom',
          count: 1,
        },
      ],
    });
    expect(metrics.cachePrewarm.lastFailedAtByCategory.dashboardHome).toEqual(
      metrics.cachePrewarm.recentCycles[0]?.capturedAt,
    );
    expect(
      metrics.cachePrewarm.lastFailedAtByCategory.businessAnalysis,
    ).toBeNull();
    expect(
      metrics.cachePrewarm.lastFailedAtByCategory.financeOverview,
    ).toBeNull();
    expect(metrics.cachePrewarm.lastFailedKeyByCategory).toEqual({
      dashboardHome: 'profit:dashboard:home:store:18:period:today',
      businessAnalysis: null,
      financeOverview: null,
    });
    expect(metrics.cachePrewarm.lastFailedSampleByCategory).toEqual({
      dashboardHome: {
        capturedAt: metrics.cachePrewarm.recentCycles[0]?.capturedAt ?? '',
        cacheKey: 'profit:dashboard:home:store:18:period:today',
        durationMs: expect.any(Number),
        errorTag: 'Error',
        failedReason: 'boom',
      },
      businessAnalysis: null,
      financeOverview: null,
    });
    expect(
      metrics.cachePrewarm.recentCycles[0]?.failedKeyCountByCategory,
    ).toEqual({
      dashboardHome: 1,
      businessAnalysis: 0,
      financeOverview: 0,
    });
    expect(metrics.cachePrewarm.recentCycles[0]?.slowestFailedReason).toBe(
      'Error:boom',
    );
    expect(
      metrics.cachePrewarm.recentCycles[0]?.slowKeySamples[0],
    ).toMatchObject({
      category: 'dashboardHome',
      cacheKey: 'profit:dashboard:home:store:18:period:today',
      status: 'failed',
      errorTag: 'Error',
      failedReason: 'boom',
    });
  });

  it('failedReasonTopN 会聚合最近多轮最常见失败原因', async () => {
    redisService.scanKeysByPattern
      .mockResolvedValueOnce(['profit:dashboard:home:store:18:period:today'])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(['profit:finance:overview:store:18:period:month']);
    dashboardHomeService.warmOverviewCache.mockRejectedValueOnce(
      new Error('boom'),
    );
    financeOverviewService.warmOverviewCache.mockRejectedValueOnce(
      new Error('boom'),
    );

    service.onModuleInit();
    await jest.advanceTimersByTimeAsync(61_100);

    const metrics = getRuntimeMetricsSnapshot();
    expect(metrics.cachePrewarm.recentCycles.length).toBeGreaterThanOrEqual(2);
    expect(metrics.cachePrewarm.failedReasonTopN[0]).toEqual({
      errorTag: 'Error',
      failedReason: 'boom',
      count: 2,
    });
  });

  it('failedReasonTopNByCategory 会按类别聚合最常见失败原因', async () => {
    redisService.scanKeysByPattern
      .mockResolvedValueOnce(['profit:dashboard:home:store:18:period:today'])
      .mockResolvedValueOnce([
        'profit:business-analysis:store:18:period:month:start:na:end:na',
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(['profit:dashboard:home:store:18:period:today'])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(['profit:finance:overview:store:18:period:month']);
    dashboardHomeService.warmOverviewCache
      .mockRejectedValueOnce(new Error('boom'))
      .mockRejectedValueOnce(new Error('boom'));
    businessAnalysisService.warmAnalysisCache.mockRejectedValueOnce(
      new Error('timeout'),
    );
    financeOverviewService.warmOverviewCache.mockRejectedValueOnce(
      new Error('boom'),
    );

    service.onModuleInit();
    await jest.advanceTimersByTimeAsync(61_100);

    const metrics = getRuntimeMetricsSnapshot();
    expect(metrics.cachePrewarm.failedReasonTopNByCategory).toEqual([
      {
        category: 'dashboardHome',
        failedCount: 2,
        topReasons: [
          {
            errorTag: 'Error',
            failedReason: 'boom',
            count: 2,
          },
        ],
      },
      {
        category: 'businessAnalysis',
        failedCount: 1,
        topReasons: [
          {
            errorTag: 'Error',
            failedReason: 'timeout',
            count: 1,
          },
        ],
      },
      {
        category: 'financeOverview',
        failedCount: 1,
        topReasons: [
          {
            errorTag: 'Error',
            failedReason: 'boom',
            count: 1,
          },
        ],
      },
    ]);
    expect(metrics.cachePrewarm.lastFailedAtByCategory).toEqual({
      dashboardHome: metrics.cachePrewarm.recentCycles[0]?.capturedAt ?? null,
      businessAnalysis:
        metrics.cachePrewarm.recentCycles[1]?.capturedAt ?? null,
      financeOverview: metrics.cachePrewarm.recentCycles[0]?.capturedAt ?? null,
    });
    expect(metrics.cachePrewarm.lastFailedKeyByCategory).toEqual({
      dashboardHome: 'profit:dashboard:home:store:18:period:today',
      businessAnalysis:
        'profit:business-analysis:store:18:period:month:start:na:end:na',
      financeOverview: 'profit:finance:overview:store:18:period:month',
    });
    expect(metrics.cachePrewarm.lastFailedSampleByCategory).toEqual({
      dashboardHome: {
        capturedAt: metrics.cachePrewarm.recentCycles[0]?.capturedAt ?? '',
        cacheKey: 'profit:dashboard:home:store:18:period:today',
        durationMs: expect.any(Number),
        errorTag: 'Error',
        failedReason: 'boom',
      },
      businessAnalysis: {
        capturedAt: metrics.cachePrewarm.recentCycles[1]?.capturedAt ?? '',
        cacheKey:
          'profit:business-analysis:store:18:period:month:start:na:end:na',
        durationMs: expect.any(Number),
        errorTag: 'Error',
        failedReason: 'timeout',
      },
      financeOverview: {
        capturedAt: metrics.cachePrewarm.recentCycles[0]?.capturedAt ?? '',
        cacheKey: 'profit:finance:overview:store:18:period:month',
        durationMs: expect.any(Number),
        errorTag: 'Error',
        failedReason: 'boom',
      },
    });
  });

  it('会按配置限制单类预热并发度', async () => {
    let activeCount = 0;
    let maxActiveCount = 0;

    redisService.scanKeysByPattern
      .mockResolvedValueOnce([
        'profit:dashboard:home:store:18:period:today',
        'profit:dashboard:home:store:19:period:today',
        'profit:dashboard:home:store:20:period:today',
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    dashboardHomeService.warmOverviewCache.mockImplementation(async () => {
      activeCount += 1;
      maxActiveCount = Math.max(maxActiveCount, activeCount);
      await new Promise((resolve) => setTimeout(resolve, 50));
      activeCount -= 1;
    });

    service.onModuleInit();
    await jest.advanceTimersByTimeAsync(1_200);

    expect(maxActiveCount).toBeLessThanOrEqual(2);
    expect(dashboardHomeService.warmOverviewCache).toHaveBeenCalledTimes(3);
  });

  it('禁用时不会注册预热定时器', () => {
    configService.get.mockImplementation((key: string) => {
      const configMap: Record<string, number | boolean> = {
        'app.cachePrewarmEnabled': false,
        'app.cachePrewarmIntervalMs': 60_000,
        'app.cachePrewarmInitialDelayMs': 1_000,
        'app.cachePrewarmBatchSize': 10,
        'app.cachePrewarmConcurrency': 2,
        'app.cachePrewarmLogEnabled': true,
        'app.cachePrewarmLogSampleEvery': 20,
        'app.cachePrewarmSlowCycleThresholdMs': 1_500,
      };
      return configMap[key];
    });

    const disabledService = new CachePrewarmService(
      configService as unknown as ConfigService,
      redisService as unknown as RedisService,
      dashboardHomeService as unknown as DashboardHomeService,
      businessAnalysisService as unknown as BusinessAnalysisService,
      financeOverviewService as unknown as FinanceOverviewService,
    );

    disabledService.onModuleInit();
    jest.advanceTimersByTime(2_000);

    expect(redisService.scanKeysByPattern).not.toHaveBeenCalled();
    disabledService.onModuleDestroy();
  });
});
