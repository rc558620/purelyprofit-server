import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PlatformMembershipAccessService } from '../../member/platform-membership/platform-membership-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { SalesRecordListService } from './sales-record-list.service';
import { getEndOfDay, getStartOfDay } from '../../commerce/commerce.utils';

describe('SalesRecordListService', () => {
  let service: SalesRecordListService;

  const prismaService = {
    $queryRaw: jest.fn(),
    saleOrder: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
  };

  const configService = {
    get: jest.fn(),
  };

  const commerceAccessService = {
    resolveViewStoreId: jest.fn(),
  };

  const platformMembershipAccessService = {
    clampHistoryRange: jest.fn(),
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
    jest.useFakeTimers().setSystemTime(new Date('2026-05-14T12:00:00.000Z'));
    jest.clearAllMocks();
    prismaService.$queryRaw.mockResolvedValue([
      { revenue: 0, profit: 0, order_count: BigInt(0) },
    ]);
    configService.get.mockImplementation((key: string) => {
      const configMap: Record<string, number> = {
        'app.defaultPageSize': 20,
        'app.maxPageSize': 100,
      };

      return configMap[key];
    });
    platformMembershipAccessService.clampHistoryRange.mockImplementation(
      (_storeId: number, range: { start: number; end: number }) =>
        Promise.resolve({
          start: range.start,
          end: range.end,
          clamped: false,
          empty: false,
        }),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalesRecordListService,
        { provide: PrismaService, useValue: prismaService },
        { provide: ConfigService, useValue: configService },
        { provide: CommerceAccessService, useValue: commerceAccessService },
        {
          provide: PlatformMembershipAccessService,
          useValue: platformMembershipAccessService,
        },
      ],
    }).compile();

    service = module.get<SalesRecordListService>(SalesRecordListService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('list 在无可访问门店时返回空分页', async () => {
    commerceAccessService.resolveViewStoreId.mockResolvedValue(null);

    await expect(
      service.list(user, { storeId: 18, period: 'all' }),
    ).resolves.toEqual({
      items: [],
      meta: {
        page: 1,
        pageSize: 20,
        total: 0,
        totalPages: 1,
      },
      summary: {
        totalRevenue: 0,
        totalProfit: 0,
        orderCount: 0,
        avgOrderValue: 0,
        compareLastPeriod: null,
      },
    });

    expect(prismaService.saleOrder.findMany).not.toHaveBeenCalled();
    expect(prismaService.saleOrder.count).not.toHaveBeenCalled();
  });

  it('list 按前端字段返回销售记录分页列表', async () => {
    const saleDate = new Date('2026-05-14T10:00:00.000Z');
    const createdAt = new Date('2026-05-14T10:10:00.000Z');

    commerceAccessService.resolveViewStoreId.mockResolvedValue(18);
    prismaService.saleOrder.count.mockResolvedValue(1);
    prismaService.saleOrder.findMany.mockResolvedValue([
      {
        id: 11,
        storeId: 18,
        operatorStaffId: 8,
        orderNo: '#20260514-001',
        totalRevenue: new Prisma.Decimal('3700'),
        totalProfit: new Prisma.Decimal('1040'),
        totalQuantity: 5,
        paymentMethod: 'cash',
        calcMode: 'business',
        note: '晚高峰补录',
        date: saleDate,
        createdAt,
        updatedAt: createdAt,
        items: [
          {
            id: 101,
            orderId: 11,
            storeId: 18,
            productId: null,
            productName: '手打柠檬茶',
            categoryName: '饮品',
            salePrice: new Prisma.Decimal('1850'),
            profit: new Prisma.Decimal('520'),
            quantity: 2,
            image: null,
            createdAt,
          },
        ],
      },
    ]);

    await expect(
      service.list(user, {
        storeId: 18,
        period: 'all',
      }),
    ).resolves.toEqual({
      items: [
        {
          id: '11',
          orderNo: '#20260514-001',
          items: [
            {
              productId: 'manual_101',
              productName: '手打柠檬茶',
              categoryName: '饮品',
              salePrice: 18.5,
              profit: 5.2,
              quantity: 2,
              subtotal: 37,
            },
          ],
          totalRevenue: 37,
          totalProfit: 10.4,
          totalQuantity: 2,
          paymentMethod: 'cash',
          paymentLabel: '现金',
          calcMode: 'business',
          note: '晚高峰补录',
          date: saleDate.getTime(),
          createdAt: createdAt.getTime(),
          refundedAt: null,
        },
      ],
      meta: {
        page: 1,
        pageSize: 20,
        total: 1,
        totalPages: 1,
      },
      summary: {
        totalRevenue: 0,
        totalProfit: 0,
        orderCount: 0,
        avgOrderValue: 0,
        compareLastPeriod: null,
      },
    });
    expect(prismaService.saleOrder.count).toHaveBeenCalled();
  });

  it('listFrontendOrders 默认返回 purelyProfit 前端兼容分页结构', async () => {
    const saleDate = new Date('2026-05-14T10:00:00.000Z');
    const createdAt = new Date('2026-05-14T10:10:00.000Z');

    commerceAccessService.resolveViewStoreId.mockResolvedValue(18);
    prismaService.saleOrder.count.mockResolvedValue(1);
    prismaService.saleOrder.findMany.mockResolvedValue([
      {
        id: 11,
        storeId: 18,
        operatorStaffId: 8,
        orderNo: '#20260514-001',
        totalRevenue: new Prisma.Decimal('3700'),
        totalProfit: new Prisma.Decimal('1040'),
        totalQuantity: 5,
        paymentMethod: 'cash',
        calcMode: 'business',
        note: '晚高峰补录',
        date: saleDate,
        createdAt,
        updatedAt: createdAt,
        items: [
          {
            id: 101,
            orderId: 11,
            storeId: 18,
            productId: null,
            productName: '手打柠檬茶',
            categoryName: '饮品',
            salePrice: new Prisma.Decimal('1850'),
            profit: new Prisma.Decimal('520'),
            quantity: 2,
            image: null,
            createdAt,
          },
        ],
      },
    ]);

    await expect(
      service.listFrontendOrders(user, { storeId: 18 }),
    ).resolves.toEqual({
      items: [
        {
          id: '11',
          orderNo: '#20260514-001',
          items: [
            {
              productId: 'manual_101',
              productName: '手打柠檬茶',
              categoryName: '饮品',
              salePrice: 18.5,
              profit: 5.2,
              quantity: 2,
              subtotal: 37,
            },
          ],
          totalRevenue: 37,
          totalProfit: 10.4,
          totalQuantity: 2,
          paymentMethod: 'cash',
          paymentLabel: '现金',
          calcMode: 'business',
          note: '晚高峰补录',
          date: saleDate.getTime(),
          createdAt: createdAt.getTime(),
          refundedAt: null,
        },
      ],
      meta: {
        page: 1,
        pageSize: 20,
        total: 1,
        totalPages: 1,
      },
      summary: {
        totalRevenue: 0,
        totalProfit: 0,
        orderCount: 0,
        avgOrderValue: 0,
        compareLastPeriod: null,
      },
    });
    expect(prismaService.saleOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          date: expect.objectContaining({
            gte: new Date(0),
          }),
        }),
      }),
    );
  });

  it('list 在缺失 period 但传入显式时间范围时应按 custom_range 查询', async () => {
    commerceAccessService.resolveViewStoreId.mockResolvedValue(18);
    prismaService.saleOrder.count.mockResolvedValue(0);
    prismaService.saleOrder.findMany.mockResolvedValue([]);

    await service.list(user, {
      storeId: 18,
      rangeStartDate: new Date('2026-01-01T00:00:00.000Z').getTime(),
      rangeEndDate: new Date('2026-05-30T23:59:59.999Z').getTime(),
    });

    expect(prismaService.saleOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          date: {
            gte: getStartOfDay(new Date('2026-01-01T00:00:00.000Z').getTime()),
            lte: getEndOfDay(new Date('2026-05-30T23:59:59.999Z').getTime()),
          },
        }),
      }),
    );
    expect(prismaService.saleOrder.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          date: {
            gte: getStartOfDay(new Date('2026-01-01T00:00:00.000Z').getTime()),
            lte: getEndOfDay(new Date('2026-05-30T23:59:59.999Z').getTime()),
          },
        }),
      }),
    );
  });

  it('listFrontendOrders 在传入显式时间范围时应按 custom_range 查询', async () => {
    commerceAccessService.resolveViewStoreId.mockResolvedValue(18);
    prismaService.saleOrder.count.mockResolvedValue(0);
    prismaService.saleOrder.findMany.mockResolvedValue([]);

    await service.listFrontendOrders(user, {
      storeId: 18,
      rangeStartDate: new Date('2026-01-01T00:00:00.000Z').getTime(),
      rangeEndDate: new Date('2026-05-30T23:59:59.999Z').getTime(),
    });

    expect(prismaService.saleOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          date: {
            gte: getStartOfDay(new Date('2026-01-01T00:00:00.000Z').getTime()),
            lte: getEndOfDay(new Date('2026-05-30T23:59:59.999Z').getTime()),
          },
        }),
      }),
    );
    expect(prismaService.saleOrder.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          date: {
            gte: getStartOfDay(new Date('2026-01-01T00:00:00.000Z').getTime()),
            lte: getEndOfDay(new Date('2026-05-30T23:59:59.999Z').getTime()),
          },
        }),
      }),
    );
  });

  it('listFrontendOrders 在传入年份时应按 year 查询', async () => {
    commerceAccessService.resolveViewStoreId.mockResolvedValue(18);
    prismaService.saleOrder.count.mockResolvedValue(0);
    prismaService.saleOrder.findMany.mockResolvedValue([]);

    await service.listFrontendOrders(user, {
      storeId: 18,
      year: 2026,
    });

    expect(prismaService.saleOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          date: {
            gte: new Date(2026, 0, 1, 0, 0, 0, 0),
            lte: new Date(2026, 11, 31, 23, 59, 59, 999),
          },
        }),
      }),
    );
  });

  it('list 会按会员历史窗口裁剪查询范围', async () => {
    commerceAccessService.resolveViewStoreId.mockResolvedValue(18);
    platformMembershipAccessService.clampHistoryRange.mockResolvedValueOnce({
      start: new Date('2026-05-08T00:00:00.000Z').getTime(),
      end: new Date('2026-05-14T12:00:00.000Z').getTime(),
      clamped: true,
      empty: false,
    });
    prismaService.saleOrder.count.mockResolvedValue(0);
    prismaService.saleOrder.findMany.mockResolvedValue([]);

    await service.list(user, { storeId: 18, period: 'all' });

    expect(prismaService.saleOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          date: {
            gte: new Date('2026-05-08T00:00:00.000Z'),
            lte: new Date('2026-05-14T12:00:00.000Z'),
          },
        }),
      }),
    );
    expect(prismaService.saleOrder.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          date: {
            gte: new Date('2026-05-08T00:00:00.000Z'),
            lte: new Date('2026-05-14T12:00:00.000Z'),
          },
        }),
      }),
    );
  });
});
