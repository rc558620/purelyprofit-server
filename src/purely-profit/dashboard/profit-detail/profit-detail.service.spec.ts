import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PlatformMembershipAccessService } from '../../member/platform-membership/platform-membership-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { RefreshableCacheService } from '../../../redis/refreshable-cache.service';
import { ProfitDetailService } from './profit-detail.service';

describe('ProfitDetailService', () => {
  let service: ProfitDetailService;

  const prismaService = {
    saleOrderItem: {
      findMany: jest.fn(),
    },
    costRecord: {
      findMany: jest.fn(),
    },
  };

  const commerceAccessService = {
    resolveSingleStoreId: jest.fn(),
  };

  const platformMembershipAccessService = {
    clampHistoryRange: jest.fn(),
    ensureReportExportEnabled: jest.fn(),
  };

  const refreshableCache = {
    getOrLoadRefreshableJson: jest.fn((_options: any) => _options.loadValue()),
    writeRefreshableJson: jest.fn(),
  };

  const user: AuthenticatedUser = {
    id: 1,
    email: 'boss@example.com',
    phone: '13800138000',
    name: '老板',
    createdAt: new Date('2026-05-12T00:00:00.000Z'),
    updatedAt: new Date('2026-05-13T00:00:00.000Z'),
    lastActiveAt: null,
    currentMembership: {
      staffId: 8,
      storeId: 18,
      role: 'owner',
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
    jest.useFakeTimers().setSystemTime(new Date(2026, 4, 14, 12, 0, 0, 0));
    jest.clearAllMocks();
    platformMembershipAccessService.clampHistoryRange.mockImplementation(
      (_storeId: number, range: { start: number; end: number }) => ({
        start: range.start,
        end: range.end,
        clamped: false,
        empty: false,
      }),
    );
    platformMembershipAccessService.ensureReportExportEnabled.mockResolvedValue(
      undefined,
    );
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProfitDetailService,
        { provide: PrismaService, useValue: prismaService },
        {
          provide: RefreshableCacheService,
          useValue: refreshableCache,
        },
        { provide: CommerceAccessService, useValue: commerceAccessService },
        {
          provide: PlatformMembershipAccessService,
          useValue: platformMembershipAccessService,
        },
      ],
    }).compile();

    service = module.get<ProfitDetailService>(ProfitDetailService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('getProfitDetail 按前端利润详情字段聚合返回', async () => {
    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
    prismaService.saleOrderItem.findMany.mockResolvedValue([
      {
        productId: 1,
        productName: '可口可乐 330ml',
        categoryName: '饮品',
        salePrice: new Prisma.Decimal('650'),
        profit: new Prisma.Decimal('250'),
        quantity: 2,
        image: 'https://example.com/coke.png',
        order: {
          id: 1,
          date: new Date(2026, 4, 12, 10, 0, 0, 0),
          spaceSession: null,
        },
      },
      {
        productId: 2,
        productName: '奥利奥',
        categoryName: '零食',
        salePrice: new Prisma.Decimal('900'),
        profit: new Prisma.Decimal('300'),
        quantity: 1,
        image: null,
        order: {
          id: 2,
          date: new Date(2026, 4, 13, 10, 0, 0, 0),
          spaceSession: null,
        },
      },
      {
        productId: 3,
        productName: '上期商品',
        categoryName: '饮品',
        salePrice: new Prisma.Decimal('800'),
        profit: new Prisma.Decimal('200'),
        quantity: 3,
        image: null,
        order: {
          id: 3,
          date: new Date(2026, 4, 10, 10, 0, 0, 0),
          spaceSession: null,
        },
      },
    ]);
    prismaService.costRecord.findMany.mockResolvedValue([
      {
        category: 'rent',
        amount: new Prisma.Decimal('800'),
        date: new Date(2026, 4, 12, 9, 0, 0, 0),
      },
      {
        category: 'purchase',
        amount: new Prisma.Decimal('300'),
        date: new Date(2026, 4, 13, 9, 0, 0, 0),
      },
      {
        category: 'marketing',
        amount: new Prisma.Decimal('400'),
        date: new Date(2026, 4, 10, 9, 0, 0, 0),
      },
    ]);

    await expect(
      service.getProfitDetail(user, {
        period: 'custom_range',
        rangeStartDate: new Date(2026, 4, 12, 0, 0, 0, 0).getTime(),
        rangeEndDate: new Date(2026, 4, 13, 23, 59, 59, 999).getTime(),
      }),
    ).resolves.toEqual({
      summary: {
        revenue: 22,
        totalCost: 11,
        netProfit: 11,
        profitRate: 50,
        revenueCompareLastPeriod: -8.33,
        profitCompareLastPeriod: -45,
        costCompareLastPeriod: 175,
        orderCount: 2,
      },
      dailyProfits: [
        { dateLabel: '05/12', revenue: 13, cost: 8, profit: 5 },
        { dateLabel: '05/13', revenue: 9, cost: 3, profit: 6 },
      ],
      productRanking: [
        {
          id: '1',
          name: '可口可乐 330ml',
          category: '饮品',
          price: 6.5,
          profitPerUnit: 2.5,
          quantity: 2,
          totalProfit: 5,
          totalRevenue: 13,
          profitRate: 38.46,
          image: 'https://example.com/coke.png',
        },
        {
          id: '2',
          name: '奥利奥',
          category: '零食',
          price: 9,
          profitPerUnit: 3,
          quantity: 1,
          totalProfit: 3,
          totalRevenue: 9,
          profitRate: 33.33,
        },
      ],
      costBreakdown: [
        { label: '租金', amount: 8, color: '#6366f1', percentage: 72.73 },
        { label: '进货', amount: 3, color: '#84cc16', percentage: 27.27 },
      ],
    });
  });

  it('getReport 返回报表中心可直接消费的 summary + products 契约', async () => {
    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
    prismaService.saleOrderItem.findMany.mockResolvedValue([
      {
        productId: 1,
        productName: '可口可乐 330ml',
        categoryName: '饮品',
        salePrice: new Prisma.Decimal('650'),
        profit: new Prisma.Decimal('250'),
        quantity: 2,
        image: 'https://example.com/coke.png',
        order: {
          id: 4,
          date: new Date(2026, 4, 12, 10, 0, 0, 0),
          spaceSession: null,
        },
      },
      {
        productId: 2,
        productName: '奥利奥',
        categoryName: '零食',
        salePrice: new Prisma.Decimal('900'),
        profit: new Prisma.Decimal('300'),
        quantity: 1,
        image: null,
        order: {
          id: 5,
          date: new Date(2026, 4, 13, 10, 0, 0, 0),
          spaceSession: null,
        },
      },
      {
        productId: 3,
        productName: '上期商品',
        categoryName: '饮品',
        salePrice: new Prisma.Decimal('800'),
        profit: new Prisma.Decimal('200'),
        quantity: 3,
        image: null,
        order: {
          id: 6,
          date: new Date(2026, 4, 10, 10, 0, 0, 0),
          spaceSession: null,
        },
      },
    ]);
    prismaService.costRecord.findMany.mockResolvedValue([
      {
        category: 'rent',
        amount: new Prisma.Decimal('800'),
        date: new Date(2026, 4, 12, 9, 0, 0, 0),
      },
      {
        category: 'purchase',
        amount: new Prisma.Decimal('300'),
        date: new Date(2026, 4, 13, 9, 0, 0, 0),
      },
      {
        category: 'marketing',
        amount: new Prisma.Decimal('400'),
        date: new Date(2026, 4, 10, 9, 0, 0, 0),
      },
    ]);

    await expect(
      service.getReport(user, {
        period: 'custom_range',
        rangeStartDate: new Date(2026, 4, 12, 0, 0, 0, 0).getTime(),
        rangeEndDate: new Date(2026, 4, 13, 23, 59, 59, 999).getTime(),
      }),
    ).resolves.toEqual({
      summary: {
        revenue: 22,
        totalCost: 11,
        netProfit: 11,
        profitRate: 50,
        revenueCompareLastPeriod: -8.33,
        profitCompareLastPeriod: -45,
        costCompareLastPeriod: 175,
        orderCount: 2,
      },
      products: [
        {
          id: '1',
          name: '可口可乐 330ml',
          category: '饮品',
          quantity: 2,
          totalRevenue: 13,
          totalProfit: 5,
          profitRate: 38.46,
        },
        {
          id: '2',
          name: '奥利奥',
          category: '零食',
          quantity: 1,
          totalRevenue: 9,
          totalProfit: 3,
          profitRate: 33.33,
        },
      ],
    });
  });

  it('getReport 会为台位费与抵扣商品补充空间名称并按空间拆分', async () => {
    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
    prismaService.saleOrderItem.findMany.mockResolvedValue([
      {
        productId: null,
        productName: '台位费（固定）',
        categoryName: '场地费',
        salePrice: new Prisma.Decimal('1000'),
        profit: new Prisma.Decimal('1000'),
        quantity: 1,
        image: null,
        order: {
          id: 10,
          date: new Date(2026, 4, 12, 10, 0, 0, 0),
          spaceSession: {
            space: {
              name: '大厅A01',
            },
          },
        },
      },
      {
        productId: null,
        productName: '台位费（固定）',
        categoryName: '场地费',
        salePrice: new Prisma.Decimal('800'),
        profit: new Prisma.Decimal('800'),
        quantity: 1,
        image: null,
        order: {
          id: 11,
          date: new Date(2026, 4, 12, 11, 0, 0, 0),
          spaceSession: {
            space: {
              name: '大厅A02',
            },
          },
        },
      },
      {
        productId: null,
        productName: '预付款',
        categoryName: '场地费',
        salePrice: new Prisma.Decimal('-500'),
        profit: new Prisma.Decimal('-500'),
        quantity: 1,
        image: null,
        order: {
          id: 12,
          date: new Date(2026, 4, 12, 12, 0, 0, 0),
          spaceSession: {
            space: {
              name: '大厅A01',
            },
          },
        },
      },
    ]);
    prismaService.costRecord.findMany.mockResolvedValue([]);

    const result = await service.getReport(user, {
      period: 'custom_range',
      rangeStartDate: new Date(2026, 4, 12, 0, 0, 0, 0).getTime(),
      rangeEndDate: new Date(2026, 4, 12, 23, 59, 59, 999).getTime(),
    });

    expect(result.products).toEqual([
      {
        id: 'space:大厅A01台位费（固定）',
        name: '大厅A01台位费（固定）',
        category: '场地费',
        quantity: 1,
        totalRevenue: 10,
        totalProfit: 10,
        profitRate: 100,
      },
      {
        id: 'space:大厅A02台位费（固定）',
        name: '大厅A02台位费（固定）',
        category: '场地费',
        quantity: 1,
        totalRevenue: 8,
        totalProfit: 8,
        profitRate: 100,
      },
      // 预付款行已排除，不再出现在利润明细中
    ]);
  });

  it('year 周期按整年范围查询并比较上一年', async () => {
    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
    prismaService.saleOrderItem.findMany.mockResolvedValue([]);
    prismaService.costRecord.findMany.mockResolvedValue([]);

    const yearResult = await service.getProfitDetail(user, {
      period: 'year',
      year: 2025,
    });

    expect(yearResult).toMatchObject({
      summary: {
        revenue: 0,
        totalCost: 0,
        netProfit: 0,
        profitRate: 0,
        revenueCompareLastPeriod: null,
        profitCompareLastPeriod: null,
        costCompareLastPeriod: null,
        orderCount: 0,
      },
    });
    // year 周期走月聚合，固定返回 12 个趋势点
    expect(yearResult.dailyProfits).toHaveLength(12);
    expect(yearResult.dailyProfits[0].dateLabel).toBe('1月');
    expect(yearResult.dailyProfits[11].dateLabel).toBe('12月');

    expect(prismaService.saleOrderItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          storeId: 18,
          order: {
            date: {
              gte: new Date(2024, 0, 1, 0, 0, 0, 0),
              lte: new Date(2025, 11, 31, 23, 59, 59, 999),
            },
          },
        }),
      }),
    );
    expect(prismaService.costRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          storeId: 18,
          date: {
            gte: new Date(2024, 0, 1, 0, 0, 0, 0),
            lte: new Date(2025, 11, 31, 23, 59, 59, 999),
          },
        }),
      }),
    );
  });

  it('today 周期按当前可见天数返回趋势', async () => {
    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
    prismaService.saleOrderItem.findMany.mockResolvedValue([
      {
        productId: 1,
        productName: '可口可乐 330ml',
        categoryName: '饮品',
        salePrice: new Prisma.Decimal('650'),
        profit: new Prisma.Decimal('250'),
        quantity: 1,
        image: null,
        order: {
          id: 20,
          date: new Date(2026, 4, 14, 10, 0, 0, 0),
          spaceSession: null,
        },
      },
    ]);
    prismaService.costRecord.findMany.mockResolvedValue([]);

    const result = await service.getProfitDetail(user, { period: 'today' });

    expect(result.dailyProfits).toEqual([
      {
        dateLabel: '05/14',
        revenue: 6.5,
        cost: 0,
        profit: 6.5,
      },
    ]);
    expect(result.summary.orderCount).toBe(1);
  });

  it('getReport 在导出模式下会校验报表导出权限', async () => {
    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
    platformMembershipAccessService.ensureReportExportEnabled.mockRejectedValueOnce(
      new Error('forbidden'),
    );

    await expect(
      service.getReport(user, { period: 'today', export: true }),
    ).rejects.toThrow('forbidden');
    expect(
      platformMembershipAccessService.ensureReportExportEnabled,
    ).toHaveBeenCalledWith(18, false);
  });

  it('getProfitDetail 会按会员历史窗口裁剪查询范围', async () => {
    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
    platformMembershipAccessService.clampHistoryRange
      .mockResolvedValueOnce({
        start: new Date(2026, 4, 8, 0, 0, 0, 0).getTime(),
        end: new Date(2026, 4, 13, 23, 59, 59, 999).getTime(),
        clamped: true,
        empty: false,
      })
      .mockResolvedValueOnce({
        start: new Date(2026, 4, 8, 0, 0, 0, 0).getTime(),
        end: new Date(2026, 4, 7, 23, 59, 59, 999).getTime(),
        clamped: true,
        empty: true,
      });
    prismaService.saleOrderItem.findMany.mockResolvedValue([]);
    prismaService.costRecord.findMany.mockResolvedValue([]);

    await service.getProfitDetail(user, {
      period: 'custom_range',
      rangeStartDate: new Date(2026, 4, 1, 0, 0, 0, 0).getTime(),
      rangeEndDate: new Date(2026, 4, 13, 23, 59, 59, 999).getTime(),
    });

    expect(prismaService.saleOrderItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          order: {
            date: {
              gte: new Date(2026, 4, 8, 0, 0, 0, 0),
              lte: new Date(2026, 4, 13, 23, 59, 59, 999),
            },
          },
        }),
      }),
    );
  });

  it('getProfitDetail 在历史窗口裁剪后仅返回可见天数趋势', async () => {
    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
    platformMembershipAccessService.clampHistoryRange
      .mockResolvedValueOnce({
        start: new Date(2026, 4, 8, 0, 0, 0, 0).getTime(),
        end: new Date(2026, 4, 14, 12, 0, 0, 0).getTime(),
        clamped: true,
        empty: false,
      })
      .mockResolvedValueOnce({
        start: new Date(2026, 4, 8, 0, 0, 0, 0).getTime(),
        end: new Date(2026, 4, 7, 23, 59, 59, 999).getTime(),
        clamped: true,
        empty: true,
      });
    prismaService.saleOrderItem.findMany.mockResolvedValue([]);
    prismaService.costRecord.findMany.mockResolvedValue([]);

    const result = await service.getProfitDetail(user, { period: 'month' });

    expect(result.dailyProfits).toHaveLength(7);
    expect(result.dailyProfits[0]).toEqual({
      dateLabel: '05/08',
      revenue: 0,
      cost: 0,
      profit: 0,
    });
    expect(result.dailyProfits[result.dailyProfits.length - 1]).toEqual({
      dateLabel: '05/14',
      revenue: 0,
      cost: 0,
      profit: 0,
    });
  });

  it('custom_month 会兼容 startTime/endTime 参数', async () => {
    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
    prismaService.saleOrderItem.findMany.mockResolvedValue([]);
    prismaService.costRecord.findMany.mockResolvedValue([]);

    const result = await service.getProfitDetail(user, {
      period: 'custom_month',
      startTime: new Date(2026, 4, 14, 10, 0, 0, 0).getTime(),
      endTime: new Date(2026, 4, 14, 23, 59, 59, 999).getTime(),
    });

    expect(result.summary).toMatchObject({
      revenue: 0,
      totalCost: 0,
      netProfit: 0,
      profitRate: 0,
      orderCount: 0,
    });
    expect(result.dailyProfits).toEqual([
      {
        dateLabel: '05/14',
        revenue: 0,
        cost: 0,
        profit: 0,
      },
    ]);
    expect(result.productRanking).toEqual([]);
    expect(result.costBreakdown).toEqual([]);
  });

  it('custom_range 会兼容 startTime/endTime 参数', async () => {
    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
    prismaService.saleOrderItem.findMany.mockResolvedValue([]);
    prismaService.costRecord.findMany.mockResolvedValue([]);

    const result = await service.getProfitDetail(user, {
      period: 'custom_range',
      startTime: new Date(2026, 4, 1, 0, 0, 0, 0).getTime(),
      endTime: new Date(2026, 4, 26, 23, 59, 59, 999).getTime(),
    });

    expect(result.summary).toMatchObject({
      revenue: 0,
      totalCost: 0,
      netProfit: 0,
      profitRate: 0,
      orderCount: 0,
    });
    expect(result.dailyProfits).toHaveLength(26);
    expect(result.dailyProfits[0]).toEqual({
      dateLabel: '05/01',
      revenue: 0,
      cost: 0,
      profit: 0,
    });
    expect(result.dailyProfits[result.dailyProfits.length - 1]).toEqual({
      dateLabel: '05/26',
      revenue: 0,
      cost: 0,
      profit: 0,
    });
    expect(result.productRanking).toEqual([]);
    expect(result.costBreakdown).toEqual([]);
  });

  it('custom_month 缺少 customDate 时抛错', async () => {
    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);

    await expect(
      service.getProfitDetail(user, { period: 'custom_month' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('custom_range 缺少区间参数时抛错', async () => {
    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);

    await expect(
      service.getProfitDetail(user, { period: 'custom_range' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
