import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../commerce/commerce-access.service';
import { PrismaService } from '../prisma/prisma.service';
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
    },
  };

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 4, 14, 12, 0, 0, 0));
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProfitDetailService,
        { provide: PrismaService, useValue: prismaService },
        { provide: CommerceAccessService, useValue: commerceAccessService },
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
        salePrice: new Prisma.Decimal('6.50'),
        profit: new Prisma.Decimal('2.50'),
        quantity: 2,
        image: 'https://example.com/coke.png',
        order: {
          date: new Date(2026, 4, 12, 10, 0, 0, 0),
        },
      },
      {
        productId: 2,
        productName: '奥利奥',
        categoryName: '零食',
        salePrice: new Prisma.Decimal('9.00'),
        profit: new Prisma.Decimal('3.00'),
        quantity: 1,
        image: null,
        order: {
          date: new Date(2026, 4, 13, 10, 0, 0, 0),
        },
      },
      {
        productId: 3,
        productName: '上期商品',
        categoryName: '饮品',
        salePrice: new Prisma.Decimal('8.00'),
        profit: new Prisma.Decimal('2.00'),
        quantity: 3,
        image: null,
        order: {
          date: new Date(2026, 4, 10, 10, 0, 0, 0),
        },
      },
    ]);
    prismaService.costRecord.findMany.mockResolvedValue([
      {
        category: 'rent',
        amount: new Prisma.Decimal('8.00'),
        date: new Date(2026, 4, 12, 9, 0, 0, 0),
      },
      {
        category: 'purchase',
        amount: new Prisma.Decimal('3.00'),
        date: new Date(2026, 4, 13, 9, 0, 0, 0),
      },
      {
        category: 'marketing',
        amount: new Prisma.Decimal('4.00'),
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
        compareLastPeriod: -8.33,
        orderCount: 3,
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
        salePrice: new Prisma.Decimal('6.50'),
        profit: new Prisma.Decimal('2.50'),
        quantity: 2,
        image: 'https://example.com/coke.png',
        order: {
          date: new Date(2026, 4, 12, 10, 0, 0, 0),
        },
      },
      {
        productId: 2,
        productName: '奥利奥',
        categoryName: '零食',
        salePrice: new Prisma.Decimal('9.00'),
        profit: new Prisma.Decimal('3.00'),
        quantity: 1,
        image: null,
        order: {
          date: new Date(2026, 4, 13, 10, 0, 0, 0),
        },
      },
      {
        productId: 3,
        productName: '上期商品',
        categoryName: '饮品',
        salePrice: new Prisma.Decimal('8.00'),
        profit: new Prisma.Decimal('2.00'),
        quantity: 3,
        image: null,
        order: {
          date: new Date(2026, 4, 10, 10, 0, 0, 0),
        },
      },
    ]);
    prismaService.costRecord.findMany.mockResolvedValue([
      {
        category: 'rent',
        amount: new Prisma.Decimal('8.00'),
        date: new Date(2026, 4, 12, 9, 0, 0, 0),
      },
      {
        category: 'purchase',
        amount: new Prisma.Decimal('3.00'),
        date: new Date(2026, 4, 13, 9, 0, 0, 0),
      },
      {
        category: 'marketing',
        amount: new Prisma.Decimal('4.00'),
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
        compareLastPeriod: -8.33,
        orderCount: 3,
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

  it('year 周期按整年范围查询并比较上一年', async () => {
    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
    prismaService.saleOrderItem.findMany.mockResolvedValue([]);
    prismaService.costRecord.findMany.mockResolvedValue([]);

    await expect(
      service.getProfitDetail(user, {
        period: 'year',
        year: 2025,
      }),
    ).resolves.toMatchObject({
      summary: {
        revenue: 0,
        totalCost: 0,
        netProfit: 0,
        profitRate: 0,
        compareLastPeriod: null,
        orderCount: 0,
      },
    });

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

  it('today 周期返回最近 7 天趋势', async () => {
    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
    prismaService.saleOrderItem.findMany.mockResolvedValue([
      {
        productId: 1,
        productName: '可口可乐 330ml',
        categoryName: '饮品',
        salePrice: new Prisma.Decimal('6.50'),
        profit: new Prisma.Decimal('2.50'),
        quantity: 1,
        image: null,
        order: {
          date: new Date(2026, 4, 14, 10, 0, 0, 0),
        },
      },
    ]);
    prismaService.costRecord.findMany.mockResolvedValue([]);

    const result = await service.getProfitDetail(user, { period: 'today' });

    expect(result.dailyProfits).toHaveLength(7);
    expect(result.summary.orderCount).toBe(1);
    expect(result.dailyProfits[result.dailyProfits.length - 1]).toEqual({
      dateLabel: '05/14',
      revenue: 6.5,
      cost: 0,
      profit: 6.5,
    });
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
