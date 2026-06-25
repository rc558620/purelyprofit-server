import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  getRuntimeMetricsSnapshot,
  resetRuntimeMetrics,
} from '../observability';
import { BusinessAnalysisService } from '../purely-profit/dashboard/business-analysis/business-analysis.service';
import { DashboardHomeService } from '../purely-profit/dashboard/dashboard-home/dashboard-home.service';
import { FinanceOverviewService } from '../purely-profit/finance/finance-overview.service';
import { MarketingOverviewService } from '../purely-profit/marketing/marketing-overview.service';
import { MembersService } from '../purely-profit/member/members/members.service';
import { CachePrewarmCycleService } from './cache-prewarm-cycle.service';
import { RedisService } from './redis.service';

type RedisServiceMock = {
  scanKeysByPattern: jest.Mock;
};

type DashboardHomeServiceMock = {
  warmOverviewCache: jest.Mock;
};

type BusinessAnalysisServiceMock = {
  warmAnalysisCache: jest.Mock;
};

type FinanceOverviewServiceMock = {
  warmOverviewCache: jest.Mock;
};

type MarketingOverviewServiceMock = {
  warmOverviewCache: jest.Mock;
};

type MembersServiceMock = {
  warmMetaCache: jest.Mock;
  warmOverviewCache: jest.Mock;
};

function createRedisServiceMock(): RedisServiceMock {
  return {
    scanKeysByPattern: jest.fn(),
  };
}

function createDashboardHomeServiceMock(): DashboardHomeServiceMock {
  return {
    warmOverviewCache: jest.fn().mockResolvedValue(undefined),
  };
}

function createBusinessAnalysisServiceMock(): BusinessAnalysisServiceMock {
  return {
    warmAnalysisCache: jest.fn().mockResolvedValue(undefined),
  };
}

function createFinanceOverviewServiceMock(): FinanceOverviewServiceMock {
  return {
    warmOverviewCache: jest.fn().mockResolvedValue(undefined),
  };
}

function createMarketingOverviewServiceMock(): MarketingOverviewServiceMock {
  return {
    warmOverviewCache: jest.fn().mockResolvedValue(undefined),
  };
}

function createMembersServiceMock(): MembersServiceMock {
  return {
    warmMetaCache: jest.fn().mockResolvedValue(undefined),
    warmOverviewCache: jest.fn().mockResolvedValue(undefined),
  };
}

async function createTestingContext(): Promise<{
  service: CachePrewarmCycleService;
  redisService: RedisServiceMock;
  dashboardHomeService: DashboardHomeServiceMock;
  businessAnalysisService: BusinessAnalysisServiceMock;
  financeOverviewService: FinanceOverviewServiceMock;
  marketingOverviewService: MarketingOverviewServiceMock;
  membersService: MembersServiceMock;
}> {
  const redisService = createRedisServiceMock();
  const dashboardHomeService = createDashboardHomeServiceMock();
  const businessAnalysisService = createBusinessAnalysisServiceMock();
  const financeOverviewService = createFinanceOverviewServiceMock();
  const marketingOverviewService = createMarketingOverviewServiceMock();
  const membersService = createMembersServiceMock();

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      CachePrewarmCycleService,
      { provide: RedisService, useValue: redisService },
      { provide: DashboardHomeService, useValue: dashboardHomeService },
      { provide: BusinessAnalysisService, useValue: businessAnalysisService },
      { provide: FinanceOverviewService, useValue: financeOverviewService },
      { provide: MarketingOverviewService, useValue: marketingOverviewService },
      { provide: MembersService, useValue: membersService },
    ],
  }).compile();

  return {
    service: module.get<CachePrewarmCycleService>(CachePrewarmCycleService),
    redisService,
    dashboardHomeService,
    businessAnalysisService,
    financeOverviewService,
    marketingOverviewService,
    membersService,
  };
}

async function runDefaultCycle(
  service: CachePrewarmCycleService,
): Promise<void> {
  await service.runCycle({
    cycleId: 1,
    batchSize: 10,
    concurrency: 2,
    logEnabled: true,
    logSampleEvery: 20,
    slowCycleThresholdMs: 1_500,
  });
}

describe('CachePrewarmCycleService', () => {
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    resetRuntimeMetrics();
    jest.useFakeTimers();
    jest.clearAllMocks();
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('会扫描热点缓存并触发预热', async () => {
    const context = await createTestingContext();

    context.dashboardHomeService.warmOverviewCache.mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(resolve, 30)),
    );
    context.businessAnalysisService.warmAnalysisCache.mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(resolve, 20)),
    );
    context.financeOverviewService.warmOverviewCache.mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(resolve, 10)),
    );
    context.marketingOverviewService.warmOverviewCache.mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(resolve, 15)),
    );
    context.membersService.warmMetaCache.mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(resolve, 12)),
    );
    context.membersService.warmOverviewCache.mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(resolve, 8)),
    );
    context.redisService.scanKeysByPattern
      .mockResolvedValueOnce(['profit:dashboard:home:store:18:period:today'])
      .mockResolvedValueOnce([
        'profit:business-analysis:store:18:period:month:start:na:end:na:export:0',
      ])
      .mockResolvedValueOnce(['profit:marketing:overview:store:18'])
      .mockResolvedValueOnce(['profit:members:meta:store:18'])
      .mockResolvedValueOnce(['profit:members:overview:store:18'])
      .mockResolvedValueOnce([
        'profit:finance:overview:store:18:period:month:scope:owner',
      ]);

    const runPromise = runDefaultCycle(context.service);
    await jest.runAllTimersAsync();
    await runPromise;

    expect(context.redisService.scanKeysByPattern).toHaveBeenCalledTimes(6);
    expect(context.dashboardHomeService.warmOverviewCache).toHaveBeenCalledWith(
      18,
      'today',
    );
    expect(
      context.businessAnalysisService.warmAnalysisCache,
    ).toHaveBeenCalledWith(18, {
      period: 'month',
      startTime: undefined,
      endTime: undefined,
    });
    expect(
      context.financeOverviewService.warmOverviewCache,
    ).toHaveBeenCalledWith(18, 'month', 'owner');
    expect(
      context.marketingOverviewService.warmOverviewCache,
    ).toHaveBeenCalledWith(18);
    expect(context.membersService.warmMetaCache).toHaveBeenCalledWith(18);
    expect(context.membersService.warmOverviewCache).toHaveBeenCalledWith(18);

    const metrics = getRuntimeMetricsSnapshot();
    expect(metrics.cachePrewarm.totalCycles).toBe(1);
    expect(metrics.cachePrewarm.hitCount).toBe(6);
    expect(metrics.cachePrewarm.refreshedCount).toBe(6);
    expect(metrics.cachePrewarm.failedCount).toBe(0);
    expect(metrics.cachePrewarm.recentCycles[0]?.slowKeySamples).toEqual([
      expect.objectContaining({
        category: 'dashboardHome',
        cacheKey: 'profit:dashboard:home:store:18:period:today',
        durationMs: 30,
      }),
      expect.objectContaining({
        category: 'businessAnalysis',
        cacheKey:
          'profit:business-analysis:store:18:period:month:start:na:end:na:export:0',
        durationMs: 20,
      }),
      expect.objectContaining({
        category: 'marketingOverview',
        cacheKey: 'profit:marketing:overview:store:18',
        durationMs: 15,
      }),
      expect.objectContaining({
        category: 'membersMeta',
        cacheKey: 'profit:members:meta:store:18',
        durationMs: 12,
      }),
      expect.objectContaining({
        category: 'financeOverview',
        cacheKey: 'profit:finance:overview:store:18:period:month:scope:owner',
        durationMs: 10,
      }),
    ]);
  });

  it('预热失败或异常时会记录日志采样', async () => {
    const context = await createTestingContext();

    context.redisService.scanKeysByPattern
      .mockResolvedValueOnce(['profit:dashboard:home:store:18:period:today'])
      .mockResolvedValueOnce([
        'profit:business-analysis:store:18:period:invalid:start:na:end:na:export:0',
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        'profit:finance:overview:store:18:period:month:scope:owner',
      ]);
    context.dashboardHomeService.warmOverviewCache.mockRejectedValueOnce(
      new Error('boom'),
    );

    await runDefaultCycle(context.service);

    // NestJS Logger.log 被 spy，直接验证消息内容
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'failedKeyCountByCategory=dashboardHome:1,businessAnalysis:0,financeOverview:0,marketingOverview:0,membersMeta:0,membersOverview:0',
      ),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      '[cache-prewarm] refresh failed',
      expect.objectContaining({
        category: 'dashboardHome',
        cacheKey: 'profit:dashboard:home:store:18:period:today',
        errorTag: 'Error',
        failedReason: 'boom',
      }),
    );

    const metrics = getRuntimeMetricsSnapshot();
    expect(metrics.cachePrewarm.invalidCount).toBe(1);
    expect(metrics.cachePrewarm.failedCount).toBe(1);
    expect(metrics.cachePrewarm.failedReasonTopN).toContainEqual({
      errorTag: 'Error',
      failedReason: 'boom',
      count: 1,
    });
    expect(metrics.cachePrewarm.lastFailedKeyByCategory).toEqual({
      dashboardHome: 'profit:dashboard:home:store:18:period:today',
      businessAnalysis: null,
      financeOverview: null,
      marketingOverview: null,
      membersMeta: null,
      membersOverview: null,
    });
    expect(metrics.cachePrewarm.recentCycles[0]?.slowestFailedReason).toBe(
      'Error:boom',
    );
  });

  it('failedReasonTopN 会聚合最近多轮最常见失败原因', async () => {
    const context = await createTestingContext();

    context.redisService.scanKeysByPattern
      .mockResolvedValueOnce(['profit:dashboard:home:store:18:period:today'])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        'profit:finance:overview:store:18:period:month:scope:owner',
      ]);
    context.dashboardHomeService.warmOverviewCache.mockRejectedValueOnce(
      new Error('boom'),
    );
    context.financeOverviewService.warmOverviewCache.mockRejectedValueOnce(
      new Error('boom'),
    );

    await runDefaultCycle(context.service);
    await context.service.runCycle({
      cycleId: 2,
      batchSize: 10,
      concurrency: 2,
      logEnabled: true,
      logSampleEvery: 20,
      slowCycleThresholdMs: 1_500,
    });

    expect(
      getRuntimeMetricsSnapshot().cachePrewarm.failedReasonTopN[0],
    ).toEqual({
      errorTag: 'Error',
      failedReason: 'boom',
      count: 2,
    });
  });

  it('failedReasonTopNByCategory 会按类别聚合最常见失败原因', async () => {
    const context = await createTestingContext();

    context.redisService.scanKeysByPattern
      .mockResolvedValueOnce(['profit:dashboard:home:store:18:period:today'])
      .mockResolvedValueOnce([
        'profit:business-analysis:store:18:period:month:start:na:end:na:export:0',
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(['profit:dashboard:home:store:18:period:today'])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        'profit:finance:overview:store:18:period:month:scope:owner',
      ]);
    context.dashboardHomeService.warmOverviewCache
      .mockRejectedValueOnce(new Error('boom'))
      .mockRejectedValueOnce(new Error('boom'));
    context.businessAnalysisService.warmAnalysisCache.mockRejectedValueOnce(
      new Error('timeout'),
    );
    context.financeOverviewService.warmOverviewCache.mockRejectedValueOnce(
      new Error('boom'),
    );

    await runDefaultCycle(context.service);
    await context.service.runCycle({
      cycleId: 2,
      batchSize: 10,
      concurrency: 2,
      logEnabled: true,
      logSampleEvery: 20,
      slowCycleThresholdMs: 1_500,
    });

    expect(
      getRuntimeMetricsSnapshot().cachePrewarm.failedReasonTopNByCategory,
    ).toEqual([
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
    ]);
  });

  it('会按配置限制单类预热并发度', async () => {
    const context = await createTestingContext();
    let activeCount = 0;
    let maxActiveCount = 0;

    context.redisService.scanKeysByPattern
      .mockResolvedValueOnce([
        'profit:dashboard:home:store:18:period:today',
        'profit:dashboard:home:store:19:period:today',
        'profit:dashboard:home:store:20:period:today',
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    context.dashboardHomeService.warmOverviewCache.mockImplementation(
      async () => {
        activeCount += 1;
        maxActiveCount = Math.max(maxActiveCount, activeCount);
        await new Promise((resolve) => setTimeout(resolve, 50));
        activeCount -= 1;
      },
    );

    const runPromise = runDefaultCycle(context.service);
    await jest.runAllTimersAsync();
    await runPromise;

    expect(maxActiveCount).toBeLessThanOrEqual(2);
    expect(
      context.dashboardHomeService.warmOverviewCache,
    ).toHaveBeenCalledTimes(3);
  });
});
