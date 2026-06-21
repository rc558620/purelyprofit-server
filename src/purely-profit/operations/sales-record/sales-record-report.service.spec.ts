import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PlatformMembershipAccessService } from '../../member/platform-membership/platform-membership-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { RedisService } from '../../../redis/redis.service';
import { SalesRecordReportService } from './sales-record-report.service';

describe('SalesRecordReportService', () => {
  let service: SalesRecordReportService;

  const prismaService = {
    saleOrder: {
      findMany: jest.fn(),
    },
  };

  const redisService = {
    getOrLoadRefreshableJson: jest.fn(),
  };

  const commerceAccessService = {
    resolveViewStoreId: jest.fn(),
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
    lastActiveAt: null,
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
    jest.useFakeTimers().setSystemTime(new Date('2026-05-14T12:00:00.000Z'));
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
    redisService.getOrLoadRefreshableJson.mockImplementation(
      async ({ loadValue }: { loadValue: () => Promise<unknown> }) =>
        loadValue(),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalesRecordReportService,
        { provide: PrismaService, useValue: prismaService },
        { provide: RedisService, useValue: redisService },
        { provide: CommerceAccessService, useValue: commerceAccessService },
        {
          provide: PlatformMembershipAccessService,
          useValue: platformMembershipAccessService,
        },
      ],
    }).compile();

    service = module.get<SalesRecordReportService>(SalesRecordReportService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('getReport 在导出模式下会校验报表导出权限', async () => {
    commerceAccessService.resolveViewStoreId.mockResolvedValue(18);
    platformMembershipAccessService.ensureReportExportEnabled.mockRejectedValueOnce(
      new Error('forbidden'),
    );

    await expect(
      service.getReport(user, { storeId: 18, period: 'today', export: true }),
    ).rejects.toThrow('forbidden');
    expect(
      platformMembershipAccessService.ensureReportExportEnabled,
    ).toHaveBeenCalledWith(18, false);
  });

  it('getReport 返回报表中心可直接消费的按天商品聚合数据', async () => {
    commerceAccessService.resolveViewStoreId.mockResolvedValue(18);
    prismaService.saleOrder.findMany.mockResolvedValue([
      {
        id: 11,
        storeId: 18,
        operatorStaffId: 8,
        orderNo: '#20260514-001',
        totalRevenue: new Prisma.Decimal('36.50'),
        totalProfit: new Prisma.Decimal('9.20'),
        totalQuantity: 3,
        paymentMethod: 'cash',
        calcMode: 'business',
        note: null,
        date: new Date('2026-05-14T10:00:00.000Z'),
        createdAt: new Date('2026-05-14T10:10:00.000Z'),
        updatedAt: new Date('2026-05-14T10:10:00.000Z'),
        items: [
          {
            id: 101,
            orderId: 11,
            storeId: 18,
            productId: 201,
            productName: '可口可乐 330ml',
            categoryName: '饮品',
            salePrice: new Prisma.Decimal('6.50'),
            profit: new Prisma.Decimal('2.50'),
            quantity: 2,
            image: null,
            createdAt: new Date('2026-05-14T10:10:00.000Z'),
          },
          {
            id: 102,
            orderId: 11,
            storeId: 18,
            productId: null,
            productName: '手冲咖啡',
            categoryName: '饮品',
            salePrice: new Prisma.Decimal('23.50'),
            profit: new Prisma.Decimal('4.20'),
            quantity: 1,
            image: null,
            createdAt: new Date('2026-05-14T10:10:00.000Z'),
          },
        ],
      },
      {
        id: 12,
        storeId: 18,
        operatorStaffId: 8,
        orderNo: '#20260513-001',
        totalRevenue: new Prisma.Decimal('13.00'),
        totalProfit: new Prisma.Decimal('5.00'),
        totalQuantity: 2,
        paymentMethod: 'wechat',
        calcMode: 'business',
        note: null,
        date: new Date('2026-05-13T09:00:00.000Z'),
        createdAt: new Date('2026-05-13T09:10:00.000Z'),
        updatedAt: new Date('2026-05-13T09:10:00.000Z'),
        items: [
          {
            id: 103,
            orderId: 12,
            storeId: 18,
            productId: 201,
            productName: '可口可乐 330ml',
            categoryName: '饮品',
            salePrice: new Prisma.Decimal('6.50'),
            profit: new Prisma.Decimal('2.50'),
            quantity: 2,
            image: null,
            createdAt: new Date('2026-05-13T09:10:00.000Z'),
          },
        ],
      },
    ]);

    await expect(
      service.getReport(user, {
        storeId: 18,
        period: 'month',
      }),
    ).resolves.toEqual({
      summary: {
        totalQuantity: 5,
        totalRevenue: 49.5,
        orderCount: 2,
        avgOrderValue: 24.75,
      },
      dailySales: [
        {
          id: `${new Date(2026, 4, 14, 0, 0, 0, 0).getTime()}-201`,
          dateLabel: '05/14',
          productName: '可口可乐 330ml',
          quantity: 2,
          revenue: 13,
        },
        {
          id: `${new Date(2026, 4, 14, 0, 0, 0, 0).getTime()}-manual_手冲咖啡`,
          dateLabel: '05/14',
          productName: '手冲咖啡',
          quantity: 1,
          revenue: 23.5,
        },
        {
          id: `${new Date(2026, 4, 13, 0, 0, 0, 0).getTime()}-201`,
          dateLabel: '05/13',
          productName: '可口可乐 330ml',
          quantity: 2,
          revenue: 13,
        },
      ],
    });
  });

  it('getReport 在同日同商品跨订单时按聚合行统计 orderCount', async () => {
    commerceAccessService.resolveViewStoreId.mockResolvedValue(18);
    prismaService.saleOrder.findMany.mockResolvedValue([
      {
        id: 21,
        storeId: 18,
        operatorStaffId: 8,
        orderNo: '#20260514-002',
        totalRevenue: new Prisma.Decimal('13.00'),
        totalProfit: new Prisma.Decimal('5.00'),
        totalQuantity: 2,
        paymentMethod: 'cash',
        calcMode: 'business',
        note: null,
        date: new Date('2026-05-14T09:00:00.000Z'),
        createdAt: new Date('2026-05-14T09:10:00.000Z'),
        updatedAt: new Date('2026-05-14T09:10:00.000Z'),
        items: [
          {
            id: 201,
            orderId: 21,
            storeId: 18,
            productId: 301,
            productName: '鲜奶',
            categoryName: '饮品',
            salePrice: new Prisma.Decimal('6.50'),
            profit: new Prisma.Decimal('2.50'),
            quantity: 2,
            image: null,
            createdAt: new Date('2026-05-14T09:10:00.000Z'),
          },
        ],
      },
      {
        id: 22,
        storeId: 18,
        operatorStaffId: 8,
        orderNo: '#20260514-003',
        totalRevenue: new Prisma.Decimal('6.50'),
        totalProfit: new Prisma.Decimal('2.50'),
        totalQuantity: 1,
        paymentMethod: 'cash',
        calcMode: 'business',
        note: null,
        date: new Date('2026-05-14T11:00:00.000Z'),
        createdAt: new Date('2026-05-14T11:10:00.000Z'),
        updatedAt: new Date('2026-05-14T11:10:00.000Z'),
        items: [
          {
            id: 202,
            orderId: 22,
            storeId: 18,
            productId: 301,
            productName: '鲜奶',
            categoryName: '饮品',
            salePrice: new Prisma.Decimal('6.50'),
            profit: new Prisma.Decimal('2.50'),
            quantity: 1,
            image: null,
            createdAt: new Date('2026-05-14T11:10:00.000Z'),
          },
        ],
      },
    ]);

    await expect(
      service.getReport(user, {
        storeId: 18,
        period: 'today',
      }),
    ).resolves.toMatchObject({
      summary: {
        totalQuantity: 3,
        totalRevenue: 19.5,
        orderCount: 2,
        avgOrderValue: 9.75,
      },
      dailySales: [
        {
          productName: '鲜奶',
          quantity: 3,
          revenue: 19.5,
        },
      ],
    });
  });

  it('getReport 会为台位费和预付抵扣补充空间名称并按空间拆分聚合', async () => {
    commerceAccessService.resolveViewStoreId.mockResolvedValue(18);
    prismaService.saleOrder.findMany.mockResolvedValue([
      {
        id: 31,
        storeId: 18,
        operatorStaffId: 8,
        orderNo: '#20260514-004',
        totalRevenue: new Prisma.Decimal('34.00'),
        totalProfit: new Prisma.Decimal('34.00'),
        totalQuantity: 2,
        paymentMethod: 'cash',
        calcMode: 'business',
        note: null,
        date: new Date('2026-05-14T12:00:00.000Z'),
        createdAt: new Date('2026-05-14T12:00:00.000Z'),
        updatedAt: new Date('2026-05-14T12:00:00.000Z'),
        spaceSession: {
          space: {
            name: '大厅A01',
          },
        },
        items: [
          {
            id: 301,
            orderId: 31,
            storeId: 18,
            productId: 401,
            productName: '特调咖啡',
            categoryName: '饮品',
            salePrice: new Prisma.Decimal('24.00'),
            profit: new Prisma.Decimal('24.00'),
            quantity: 1,
            image: null,
            createdAt: new Date('2026-05-14T12:00:00.000Z'),
          },
          {
            id: 302,
            orderId: 31,
            storeId: 18,
            productId: null,
            productName: '台位费（固定）',
            categoryName: '场地费',
            salePrice: new Prisma.Decimal('10.00'),
            profit: new Prisma.Decimal('10.00'),
            quantity: 1,
            image: null,
            createdAt: new Date('2026-05-14T12:00:00.000Z'),
          },
        ],
      },
      {
        id: 32,
        storeId: 18,
        operatorStaffId: 8,
        orderNo: '#20260514-005',
        totalRevenue: new Prisma.Decimal('8.00'),
        totalProfit: new Prisma.Decimal('8.00'),
        totalQuantity: 1,
        paymentMethod: 'cash',
        calcMode: 'business',
        note: null,
        date: new Date('2026-05-14T12:10:00.000Z'),
        createdAt: new Date('2026-05-14T12:10:00.000Z'),
        updatedAt: new Date('2026-05-14T12:10:00.000Z'),
        spaceSession: {
          space: {
            name: '大厅A02',
          },
        },
        items: [
          {
            id: 303,
            orderId: 32,
            storeId: 18,
            productId: null,
            productName: '台位费（固定）',
            categoryName: '场地费',
            salePrice: new Prisma.Decimal('8.00'),
            profit: new Prisma.Decimal('8.00'),
            quantity: 1,
            image: null,
            createdAt: new Date('2026-05-14T12:10:00.000Z'),
          },
        ],
      },
      {
        id: 33,
        storeId: 18,
        operatorStaffId: 8,
        orderNo: '#20260514-006',
        totalRevenue: new Prisma.Decimal('-5.00'),
        totalProfit: new Prisma.Decimal('-5.00'),
        totalQuantity: 0,
        paymentMethod: 'wechat',
        calcMode: 'business',
        note: null,
        date: new Date('2026-05-14T12:20:00.000Z'),
        createdAt: new Date('2026-05-14T12:20:00.000Z'),
        updatedAt: new Date('2026-05-14T12:20:00.000Z'),
        spaceSession: {
          space: {
            name: '大厅A01',
          },
        },
        items: [
          {
            id: 304,
            orderId: 33,
            storeId: 18,
            productId: null,
            productName: '预付抵扣',
            categoryName: '场地费',
            salePrice: new Prisma.Decimal('-5.00'),
            profit: new Prisma.Decimal('-5.00'),
            quantity: 1,
            image: null,
            createdAt: new Date('2026-05-14T12:20:00.000Z'),
          },
        ],
      },
    ]);

    await expect(
      service.getReport(user, {
        storeId: 18,
        period: 'month',
      }),
    ).resolves.toEqual({
      summary: {
        totalQuantity: 3,
        totalRevenue: 42,
        orderCount: 3,
        avgOrderValue: 14,
      },
      dailySales: [
        {
          id: `${new Date(2026, 4, 14, 0, 0, 0, 0).getTime()}-space_大厅A02台位费（固定）`,
          dateLabel: '05/14',
          productName: '大厅A02台位费（固定）',
          quantity: 1,
          revenue: 8,
        },
        {
          id: `${new Date(2026, 4, 14, 0, 0, 0, 0).getTime()}-space_大厅A01台位费（固定）`,
          dateLabel: '05/14',
          productName: '大厅A01台位费（固定）',
          quantity: 1,
          revenue: 10,
        },
        {
          id: `${new Date(2026, 4, 14, 0, 0, 0, 0).getTime()}-401`,
          dateLabel: '05/14',
          productName: '特调咖啡',
          quantity: 1,
          revenue: 24,
        },
      ],
    });
  });

  it('getReport 支持 year 周期并按整年范围查询', async () => {
    commerceAccessService.resolveViewStoreId.mockResolvedValue(18);
    prismaService.saleOrder.findMany.mockResolvedValue([]);

    await expect(
      service.getReport(user, {
        storeId: 18,
        period: 'year',
        year: 2025,
      }),
    ).resolves.toEqual({
      summary: {
        totalQuantity: 0,
        totalRevenue: 0,
        orderCount: 0,
        avgOrderValue: 0,
      },
      dailySales: [],
    });

    expect(prismaService.saleOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          storeId: 18,
          date: {
            gte: new Date(2025, 0, 1, 0, 0, 0, 0),
            lte: new Date(2025, 11, 31, 23, 59, 59, 999),
          },
        }),
      }),
    );
  });
});
