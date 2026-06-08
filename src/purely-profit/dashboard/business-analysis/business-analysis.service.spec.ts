import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PlatformMembershipAccessService } from '../../member/platform-membership/platform-membership-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { RedisService } from '../../../redis/redis.service';
import { BusinessAnalysisService } from './business-analysis.service';

describe('BusinessAnalysisService', () => {
  let service: BusinessAnalysisService;

  const prismaService = {
    $queryRaw: jest.fn(),
  };

  const redisService = {
    getOrLoadRefreshableJson: jest.fn(
      async (options: { loadValue: () => Promise<unknown> }) =>
        options.loadValue(),
    ),
    writeRefreshableJson: jest.fn().mockResolvedValue(undefined),
  };

  const commerceAccessService = {
    resolveSingleStoreId: jest.fn(),
  };

  const platformMembershipAccessService = {
    clampHistoryRange: jest.fn(),
    ensureReportExportEnabled: jest.fn(),
  };

  const user: AuthenticatedUser = {
    id: 1,
    email: 'boss@example.com',
    phone: '13800138000',
    name: '老板',
    createdAt: new Date('2026-05-12T00:00:00.000Z'),
    updatedAt: new Date('2026-05-13T00:00:00.000Z'),
    currentMembership: {
      staffId: 8,
      storeId: 18,
      role: 'OWNER',
      permissions: ['*'],
      isActive: true,
      subjectType: 'owner',
      linkedEmployeeId: null,
      subAccountId: null,
      subAccountRole: null,
      subAccountStatus: null,
      subAccountAssigned: false,
      canAccessHome: true,
      canUseHandover: true,
    },
  };

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-13T12:00:00.000Z'));
    jest.clearAllMocks();
    redisService.getOrLoadRefreshableJson.mockImplementation(
      async (options: { loadValue: () => Promise<unknown> }) =>
        options.loadValue(),
    );
    platformMembershipAccessService.clampHistoryRange.mockImplementation(
      (_storeId: number, range: { start: number; end: number }) => ({
        ...range,
        empty: false,
      }),
    );
    platformMembershipAccessService.ensureReportExportEnabled.mockResolvedValue(
      undefined,
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BusinessAnalysisService,
        { provide: PrismaService, useValue: prismaService },
        { provide: RedisService, useValue: redisService },
        { provide: CommerceAccessService, useValue: commerceAccessService },
        {
          provide: PlatformMembershipAccessService,
          useValue: platformMembershipAccessService,
        },
      ],
    }).compile();

    service = module.get<BusinessAnalysisService>(BusinessAnalysisService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('getAnalysis 按前端 custom_range 参数聚合返回', async () => {
    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
    prismaService.$queryRaw
      .mockResolvedValueOnce([
        {
          currentRevenue: new Prisma.Decimal('22.00'),
          currentOrderCount: 2,
          previousRevenue: new Prisma.Decimal('8.00'),
          previousOrderCount: 1,
        },
      ])
      .mockResolvedValueOnce([
        {
          bucketAt: new Date('2026-05-12T00:00:00.000Z'),
          revenue: new Prisma.Decimal('13.00'),
        },
        {
          bucketAt: new Date('2026-05-13T00:00:00.000Z'),
          revenue: new Prisma.Decimal('9.00'),
        },
      ])
      .mockResolvedValueOnce([
        {
          categoryName: '饮品',
          revenue: new Prisma.Decimal('13.00'),
          profit: new Prisma.Decimal('5.00'),
          quantity: 2,
        },
        {
          categoryName: '零食',
          revenue: new Prisma.Decimal('9.00'),
          profit: new Prisma.Decimal('3.00'),
          quantity: 1,
        },
      ])
      .mockResolvedValueOnce([
        {
          productId: 1,
          productName: '可口可乐 330ml',
          categoryName: '饮品',
          totalRevenue: new Prisma.Decimal('13.00'),
          totalProfit: new Prisma.Decimal('5.00'),
          quantity: 2,
          image: 'https://example.com/coke.png',
        },
        {
          productId: 2,
          productName: '奥利奥',
          categoryName: '零食',
          totalRevenue: new Prisma.Decimal('9.00'),
          totalProfit: new Prisma.Decimal('3.00'),
          quantity: 1,
          image: null,
        },
      ])
      .mockResolvedValueOnce([
        {
          currentTotalCost: new Prisma.Decimal('11.00'),
          previousTotalCost: new Prisma.Decimal('4.00'),
        },
      ])
      .mockResolvedValueOnce([
        {
          bucketAt: new Date('2026-05-12T00:00:00.000Z'),
          amount: new Prisma.Decimal('8.00'),
        },
        {
          bucketAt: new Date('2026-05-13T00:00:00.000Z'),
          amount: new Prisma.Decimal('3.00'),
        },
      ])
      .mockResolvedValueOnce([
        {
          category: 'purchase',
          amount: new Prisma.Decimal('8.00'),
        },
        {
          category: 'utilities',
          amount: new Prisma.Decimal('3.00'),
        },
      ]);

    await expect(
      service.getAnalysis(user, {
        period: 'custom_range',
        startTime: new Date(2026, 4, 12, 0, 0, 0, 0).getTime(),
        endTime: new Date(2026, 4, 13, 23, 59, 59, 999).getTime(),
      }),
    ).resolves.toEqual({
      heroSummary: {
        netProfit: { current: 11, previous: 4, changeRate: 175 },
        revenue: { current: 22, previous: 8, changeRate: 175 },
        totalCost: { current: 11, previous: 4, changeRate: 175 },
        profitRate: { current: 50, previous: 50, changeRate: 0 },
        orderCount: 2,
      },
      dailyTrend: [
        { dateLabel: '05/12', revenue: 13, cost: 8, profit: 5 },
        { dateLabel: '05/13', revenue: 9, cost: 3, profit: 6 },
      ],
      categoryShares: [
        {
          name: '饮品',
          revenue: 13,
          profit: 5,
          profitRate: 38.46,
          quantity: 2,
          revenueShare: 59.09,
        },
        {
          name: '零食',
          revenue: 9,
          profit: 3,
          profitRate: 33.33,
          quantity: 1,
          revenueShare: 40.91,
        },
      ],
      costRateItems: [
        { label: '进货成本', amount: 8, percentage: 72.73, color: '#f97316' },
        { label: '水电费', amount: 3, percentage: 27.27, color: '#06b6d4' },
      ],
      rankProducts: [
        {
          id: '1',
          name: '可口可乐 330ml',
          category: '饮品',
          profitRate: 38.46,
          totalProfit: 5,
          totalRevenue: 13,
          quantity: 2,
          image: 'https://example.com/coke.png',
        },
        {
          id: '2',
          name: '奥利奥',
          category: '零食',
          profitRate: 33.33,
          totalProfit: 3,
          totalRevenue: 9,
          quantity: 1,
        },
      ],
    });
    expect(prismaService.$queryRaw).toHaveBeenCalledTimes(7);
  });

  it('getAnalysis 在导出模式下会校验报表导出权限', async () => {
    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
    platformMembershipAccessService.ensureReportExportEnabled.mockRejectedValueOnce(
      new Error('forbidden'),
    );

    await expect(
      service.getAnalysis(user, { period: 'today', export: true }),
    ).rejects.toThrow('forbidden');
    expect(
      platformMembershipAccessService.ensureReportExportEnabled,
    ).toHaveBeenCalledWith(18, false);
  });

  it('month 周期会根据会员历史窗口裁剪查询范围', async () => {
    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
    platformMembershipAccessService.clampHistoryRange
      .mockResolvedValueOnce({
        start: new Date('2026-05-08T00:00:00.000Z').getTime(),
        end: new Date('2026-05-13T12:00:00.000Z').getTime(),
        empty: false,
      })
      .mockResolvedValueOnce({
        start: new Date('2026-05-02T12:00:00.000Z').getTime(),
        end: new Date('2026-05-07T23:59:59.999Z').getTime(),
        empty: true,
      });
    prismaService.$queryRaw
      .mockResolvedValueOnce([
        {
          currentRevenue: new Prisma.Decimal('0'),
          currentOrderCount: 0,
          previousRevenue: new Prisma.Decimal('0'),
          previousOrderCount: 0,
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          currentTotalCost: new Prisma.Decimal('0'),
          previousTotalCost: new Prisma.Decimal('0'),
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await service.getAnalysis(user, {
      period: 'month',
    });

    expect(
      platformMembershipAccessService.clampHistoryRange,
    ).toHaveBeenNthCalledWith(
      1,
      18,
      expect.objectContaining({
        start: new Date(2026, 4, 1, 0, 0, 0, 0).getTime(),
      }),
      false,
    );
    expect(prismaService.$queryRaw).toHaveBeenCalledTimes(7);
  });

  it('today 周期显式传入 startTime/endTime 时按前端边界查询并返回当天成本趋势', async () => {
    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
    platformMembershipAccessService.clampHistoryRange.mockResolvedValueOnce({
      start: new Date(2026, 4, 27, 0, 0, 0, 0).getTime(),
      end: new Date(2026, 4, 27, 18, 0, 0, 0).getTime(),
      empty: false,
    });
    platformMembershipAccessService.clampHistoryRange.mockResolvedValueOnce({
      start: new Date(2026, 4, 26, 6, 0, 0, 0).getTime(),
      end: new Date(2026, 4, 26, 23, 59, 59, 999).getTime(),
      empty: true,
    });
    prismaService.$queryRaw
      .mockResolvedValueOnce([
        {
          currentRevenue: new Prisma.Decimal('28293.34'),
          currentOrderCount: 1,
          previousRevenue: new Prisma.Decimal('0'),
          previousOrderCount: 0,
        },
      ])
      .mockResolvedValueOnce([
        {
          bucketAt: new Date(2026, 4, 27, 0, 0, 0, 0),
          revenue: new Prisma.Decimal('28293.34'),
        },
      ])
      .mockResolvedValueOnce([
        {
          categoryName: '饮品',
          revenue: new Prisma.Decimal('28293.34'),
          profit: new Prisma.Decimal('28293.34'),
          quantity: 2,
        },
      ])
      .mockResolvedValueOnce([
        {
          productId: 11,
          productName: '今日商品',
          categoryName: '饮品',
          totalRevenue: new Prisma.Decimal('28293.34'),
          totalProfit: new Prisma.Decimal('28293.34'),
          quantity: 2,
          image: null,
        },
      ])
      .mockResolvedValueOnce([
        {
          currentTotalCost: new Prisma.Decimal('500.00'),
          previousTotalCost: new Prisma.Decimal('0'),
        },
      ])
      .mockResolvedValueOnce([
        {
          bucketAt: new Date(2026, 4, 27, 0, 0, 0, 0),
          amount: new Prisma.Decimal('500.00'),
        },
      ])
      .mockResolvedValueOnce([
        {
          category: 'purchase',
          amount: new Prisma.Decimal('500.00'),
        },
      ]);

    const response = await service.getAnalysis(user, {
      period: 'today',
      startTime: new Date(2026, 4, 27, 0, 0, 0, 0).getTime(),
      endTime: new Date(2026, 4, 27, 18, 0, 0, 0).getTime(),
    });

    expect(response.heroSummary.totalCost.current).toBe(500);
    expect(response.dailyTrend).toEqual([
      { dateLabel: '05/27', revenue: 28293.34, cost: 500, profit: 27793.34 },
    ]);
    expect(response.costRateItems).toEqual([
      { label: '进货成本', amount: 500, percentage: 100, color: '#f97316' },
    ]);
  });

  it('custom_range 缺少时间范围时抛错', async () => {
    await expect(
      service.getAnalysis(user, {
        period: 'custom_range',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('仅传 startTime 不传 endTime 时抛错', async () => {
    await expect(
      service.getAnalysis(user, {
        period: 'today',
        startTime: 1,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('结束时间早于开始时间时抛错', async () => {
    await expect(
      service.getAnalysis(user, {
        period: 'custom_range',
        startTime: 2,
        endTime: 1,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
