import { Test, TestingModule } from '@nestjs/testing';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { BusinessAnalysisService } from '../../purely-profit/dashboard/business-analysis/business-analysis.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { PulseStoreContextService } from '../pulse-store-context.service';
import { DashboardAggregatorService } from './dashboard-aggregator.service';
import { DEFAULT_DASHBOARD_OVERVIEW_PERIOD } from './dashboard.constants';
import { PulseDashboardOverviewService } from './dashboard-overview.service';

describe('PulseDashboardOverviewService', () => {
  let service: PulseDashboardOverviewService;

  const prismaService = {
    saleOrder: {
      findMany: jest.fn(),
    },
    store: {
      findMany: jest.fn(),
    },
  };

  const redisService = {
    getOrLoadRefreshableJson: jest.fn(),
  };

  const dashboardAggregatorService = {
    aggregateSales: jest.fn(),
    aggregateCosts: jest.fn(),
    aggregateSalesByStore: jest.fn(),
    aggregateCostsByStore: jest.fn(),
  };

  const businessAnalysisService = {
    getAnalysisByStoreId: jest.fn(),
  };

  const pulseStoreContextService = {
    resolveTargetStoreOrThrow: jest.fn(),
  };

  const user: AuthenticatedUser = {
    id: 101,
    email: 'dev@example.com',
    phone: '13800138000',
    name: '开发者',
    createdAt: new Date('2026-05-12T00:00:00.000Z'),
    updatedAt: new Date('2026-05-13T00:00:00.000Z'),
    lastActiveAt: null,
    pulseMode: 'normal',
    isPulseDeveloper: true,
    currentMembership: null,
  };

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-30T12:00:00.000Z'));
    jest.clearAllMocks();
    redisService.getOrLoadRefreshableJson.mockImplementation(
      async ({ loadValue }: { loadValue: () => Promise<unknown> }) =>
        loadValue(),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PulseDashboardOverviewService,
        { provide: PrismaService, useValue: prismaService },
        { provide: RedisService, useValue: redisService },
        {
          provide: DashboardAggregatorService,
          useValue: dashboardAggregatorService,
        },
        {
          provide: PulseStoreContextService,
          useValue: pulseStoreContextService,
        },
        {
          provide: BusinessAnalysisService,
          useValue: businessAnalysisService,
        },
      ],
    }).compile();

    service = module.get<PulseDashboardOverviewService>(
      PulseDashboardOverviewService,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('getOverview 命中缓存时直接返回缓存结果', async () => {
    const cachedResponse = {
      stats: {
        profitLabel: '今日利润',
        profit: 320,
        profitChange: 12.5,
        orderLabel: '今日订单',
        orderCount: 9,
        orderChange: 30,
        revenue: 860,
        totalCost: 540,
      },
      salesTrend: {
        points: [],
      },
      meta: {
        period: 'today' as const,
        storeId: 18,
        storeCount: 1,
        startAt: Date.now() - 3600000,
        endAt: Date.now(),
        generatedAt: Date.now(),
      },
    };
    pulseStoreContextService.resolveTargetStoreOrThrow.mockResolvedValue({
      id: 18,
      name: '纯利宝南山店',
      address: '深圳市南山区',
      contactPhone: null,
      ownerId: 301,
      ownerName: '张三',
    });
    redisService.getOrLoadRefreshableJson.mockResolvedValue(cachedResponse);

    await expect(service.getOverview(user, {})).resolves.toEqual(
      cachedResponse,
    );
    expect(redisService.getOrLoadRefreshableJson).toHaveBeenCalledWith(
      expect.objectContaining({
        cacheKey: 'pulse:dashboard:overview:store:18:period:today',
        ttlSeconds: 20,
      }),
    );
    expect(dashboardAggregatorService.aggregateSales).not.toHaveBeenCalled();
    expect(prismaService.saleOrder.findMany).not.toHaveBeenCalled();
  });

  it('getOverview 未命中缓存时回源计算并写入缓存', async () => {
    pulseStoreContextService.resolveTargetStoreOrThrow.mockResolvedValue({
      id: 18,
      name: '纯利宝南山店',
      address: '深圳市南山区',
      contactPhone: null,
      ownerId: 301,
      ownerName: '张三',
    });
    dashboardAggregatorService.aggregateSales
      .mockResolvedValueOnce({
        totalRevenue: 1000,
        totalProfit: 300,
        orderCount: 12,
      })
      .mockResolvedValueOnce({
        totalRevenue: 800,
        totalProfit: 200,
        orderCount: 10,
      });
    dashboardAggregatorService.aggregateCosts
      .mockResolvedValueOnce(650)
      .mockResolvedValueOnce(500);
    prismaService.saleOrder.findMany.mockResolvedValue([
      {
        totalRevenue: 500,
        date: new Date('2026-05-30T09:00:00.000Z'),
      },
      {
        totalRevenue: 500,
        date: new Date('2026-05-30T18:00:00.000Z'),
      },
    ]);

    const response = await service.getOverview(user, {
      period: DEFAULT_DASHBOARD_OVERVIEW_PERIOD,
    });

    expect(response.stats).toEqual({
      profitLabel: '今日净利润 (元)',
      profit: 350,
      profitChange: 16.7,
      orderLabel: '今日订单数',
      orderCount: 12,
      orderChange: 20,
      revenue: 1000,
      totalCost: 650,
    });
    expect(redisService.getOrLoadRefreshableJson).toHaveBeenCalledWith(
      expect.objectContaining({
        cacheKey: 'pulse:dashboard:overview:store:18:period:today',
        ttlSeconds: 20,
      }),
    );
    expect(dashboardAggregatorService.aggregateSales).toHaveBeenCalledTimes(2);
    expect(dashboardAggregatorService.aggregateCosts).toHaveBeenCalledTimes(2);
  });
});
