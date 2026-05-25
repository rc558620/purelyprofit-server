import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PlatformMembershipAccessService } from '../../member/platform-membership/platform-membership-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { SalesRecordListService } from './sales-record-list.service';

describe('SalesRecordListService', () => {
  let service: SalesRecordListService;

  const prismaService = {
    saleOrder: {
      findMany: jest.fn(),
    },
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
    currentMembership: {
      staffId: 8,
      storeId: 18,
      role: 'OWNER',
      permissions: ['*'],
      isActive: true,
    },
  };

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-14T12:00:00.000Z'));
    jest.clearAllMocks();
    platformMembershipAccessService.clampHistoryRange.mockImplementation(
      async (_storeId: number, range: { start: number; end: number }) => ({
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

    await expect(service.list(user, { storeId: 18, period: 'all' })).resolves.toEqual({
      items: [],
      meta: {
        page: 1,
        pageSize: 1,
        total: 0,
        totalPages: 1,
      },
    });

    expect(prismaService.saleOrder.findMany).not.toHaveBeenCalled();
  });

  it('list 按前端字段返回销售记录列表', async () => {
    const saleDate = new Date('2026-05-14T10:00:00.000Z');
    const createdAt = new Date('2026-05-14T10:10:00.000Z');

    commerceAccessService.resolveViewStoreId.mockResolvedValue(18);
    prismaService.saleOrder.findMany.mockResolvedValue([
      {
        id: 11,
        storeId: 18,
        operatorStaffId: 8,
        orderNo: '#20260514-001',
        totalRevenue: new Prisma.Decimal('88.50'),
        totalProfit: new Prisma.Decimal('23.60'),
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
            salePrice: new Prisma.Decimal('18.50'),
            profit: new Prisma.Decimal('5.20'),
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
            },
          ],
          totalRevenue: 88.5,
          totalProfit: 23.6,
          totalQuantity: 5,
          paymentMethod: 'cash',
          calcMode: 'business',
          note: '晚高峰补录',
          date: saleDate.getTime(),
          createdAt: createdAt.getTime(),
        },
      ],
      meta: {
        page: 1,
        pageSize: 1,
        total: 1,
        totalPages: 1,
      },
    });
  });

  it('listFrontendOrders 默认返回 purelyProfit 前端需要的全量数组', async () => {
    const saleDate = new Date('2026-05-14T10:00:00.000Z');
    const createdAt = new Date('2026-05-14T10:10:00.000Z');

    commerceAccessService.resolveViewStoreId.mockResolvedValue(18);
    prismaService.saleOrder.findMany.mockResolvedValue([
      {
        id: 11,
        storeId: 18,
        operatorStaffId: 8,
        orderNo: '#20260514-001',
        totalRevenue: new Prisma.Decimal('88.50'),
        totalProfit: new Prisma.Decimal('23.60'),
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
            salePrice: new Prisma.Decimal('18.50'),
            profit: new Prisma.Decimal('5.20'),
            quantity: 2,
            image: null,
            createdAt,
          },
        ],
      },
    ]);

    await expect(service.listFrontendOrders(user, { storeId: 18 })).resolves.toEqual([
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
          },
        ],
        totalRevenue: 88.5,
        totalProfit: 23.6,
        totalQuantity: 5,
        paymentMethod: 'cash',
        calcMode: 'business',
        note: '晚高峰补录',
        date: saleDate.getTime(),
        createdAt: createdAt.getTime(),
      },
    ]);
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

  it('list 会按会员历史窗口裁剪查询范围', async () => {
    commerceAccessService.resolveViewStoreId.mockResolvedValue(18);
    platformMembershipAccessService.clampHistoryRange.mockResolvedValueOnce({
      start: new Date('2026-05-08T00:00:00.000Z').getTime(),
      end: new Date('2026-05-14T12:00:00.000Z').getTime(),
      clamped: true,
      empty: false,
    });
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
  });
});
