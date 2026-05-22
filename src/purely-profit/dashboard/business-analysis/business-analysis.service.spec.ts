import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { FinanceCashFlowCategory, Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { BusinessAnalysisService } from './business-analysis.service';

describe('BusinessAnalysisService', () => {
  let service: BusinessAnalysisService;

  const prismaService = {
    saleOrderItem: {
      findMany: jest.fn(),
    },
    financeCashFlowRecord: {
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
    jest.useFakeTimers().setSystemTime(new Date('2026-05-13T12:00:00.000Z'));
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BusinessAnalysisService,
        { provide: PrismaService, useValue: prismaService },
        { provide: CommerceAccessService, useValue: commerceAccessService },
      ],
    }).compile();

    service = module.get<BusinessAnalysisService>(BusinessAnalysisService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('getAnalysis 按前端 custom_range 参数聚合返回', async () => {
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
        createdAt: new Date('2026-05-12T10:00:00.000Z'),
        order: {
          id: 101,
          date: new Date('2026-05-12T10:00:00.000Z'),
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
        createdAt: new Date('2026-05-13T10:00:00.000Z'),
        order: {
          id: 102,
          date: new Date('2026-05-13T10:00:00.000Z'),
        },
      },
      {
        productId: 3,
        productName: '上期商品',
        categoryName: '饮品',
        salePrice: new Prisma.Decimal('8.00'),
        profit: new Prisma.Decimal('2.00'),
        quantity: 1,
        image: null,
        createdAt: new Date('2026-05-10T10:00:00.000Z'),
        order: {
          id: 90,
          date: new Date('2026-05-10T10:00:00.000Z'),
        },
      },
    ]);
    prismaService.financeCashFlowRecord.findMany.mockResolvedValue([
      {
        category: 'purchase' as FinanceCashFlowCategory,
        amount: new Prisma.Decimal('8.00'),
        date: new Date('2026-05-12T09:00:00.000Z'),
      },
      {
        category: 'utilities' as FinanceCashFlowCategory,
        amount: new Prisma.Decimal('3.00'),
        date: new Date('2026-05-13T09:00:00.000Z'),
      },
      {
        category: 'rent' as FinanceCashFlowCategory,
        amount: new Prisma.Decimal('4.00'),
        date: new Date('2026-05-10T09:00:00.000Z'),
      },
    ]);

    await expect(
      service.getAnalysis(user, {
        period: 'custom_range',
        startTime: new Date('2026-05-12T00:00:00.000Z').getTime(),
        endTime: new Date('2026-05-13T23:59:59.999Z').getTime(),
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
        { dateLabel: '05/14', revenue: 0, cost: 0, profit: 0 },
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
  });

  it('month 周期会根据服务端当前时间自动换算范围', async () => {
    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
    prismaService.saleOrderItem.findMany.mockResolvedValue([]);
    prismaService.financeCashFlowRecord.findMany.mockResolvedValue([]);

    await service.getAnalysis(user, {
      period: 'month',
    });

    expect(prismaService.saleOrderItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          order: {
            date: {
              gte: new Date('2026-04-17T19:59:59.999Z'),
              lte: new Date('2026-05-13T12:00:00.000Z'),
            },
          },
        }),
      }),
    );
  });

  it('custom_range 缺少时间范围时抛错', async () => {
    await expect(
      service.getAnalysis(user, {
        period: 'custom_range',
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
