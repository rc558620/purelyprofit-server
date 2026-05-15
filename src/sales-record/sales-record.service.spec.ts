import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../commerce/commerce-access.service';
import { InventoryService } from '../inventory/inventory.service';
import { PrismaService } from '../prisma/prisma.service';
import { SalesRecordService } from './sales-record.service';

describe('SalesRecordService', () => {
  let service: SalesRecordService;

  const transactionClient = {
    saleOrder: {
      count: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
    financeCashFlowRecord: {
      create: jest.fn(),
      deleteMany: jest.fn(),
    },
  };

  const prismaService = {
    saleOrder: {
      findMany: jest.fn(),
      aggregate: jest.fn(),
      findUnique: jest.fn(),
    },
    product: {
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const commerceAccessService = {
    resolveViewStoreId: jest.fn(),
    resolveSingleStoreId: jest.fn(),
    findOperatorStaffIdForStore: jest.fn(),
    ensureCanAccessStore: jest.fn(),
  };

  const inventoryService = {
    recordSaleDeduction: jest.fn(),
    revertSaleDeduction: jest.fn(),
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
    prismaService.$transaction.mockImplementation(
      (callback: (client: typeof transactionClient) => unknown) =>
        callback(transactionClient),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalesRecordService,
        { provide: PrismaService, useValue: prismaService },
        { provide: CommerceAccessService, useValue: commerceAccessService },
        { provide: InventoryService, useValue: inventoryService },
      ],
    }).compile();

    service = module.get<SalesRecordService>(SalesRecordService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('listProducts 按开始营业前端字段返回商品列表', async () => {
    commerceAccessService.resolveViewStoreId.mockResolvedValue(18);
    prismaService.product.findMany.mockResolvedValue([
      {
        id: 201,
        name: '可口可乐 330ml',
        category: '饮品',
        code: 'COLA001',
        price: new Prisma.Decimal('15.50'),
        profit: new Prisma.Decimal('4.00'),
      },
    ]);

    await expect(
      service.listProducts(user, { storeId: 18, keyword: '可乐' }),
    ).resolves.toEqual([
      {
        id: '201',
        name: '可口可乐 330ml',
        category: '饮品',
        code: 'COLA001',
        price: 4,
        salePrice: 15.5,
        quantity: 0,
      },
    ]);
    expect(prismaService.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            {
              name: {
                contains: '可乐',
                mode: 'insensitive',
              },
            },
            {
              code: {
                contains: '可乐',
                mode: 'insensitive',
              },
            },
            {
              category: {
                contains: '可乐',
                mode: 'insensitive',
              },
            },
          ],
        }),
      }),
    );
  });

  it('listProducts 有搜索词时忽略分类筛选以保持前端语义', async () => {
    commerceAccessService.resolveViewStoreId.mockResolvedValue(18);
    prismaService.product.findMany.mockResolvedValue([]);

    await service.listProducts(user, {
      storeId: 18,
      keyword: '饮品',
      category: '主食',
    });

    expect(prismaService.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({
          category: '主食',
        }),
      }),
    );
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

  it('getStats 返回当前统计与较上期变化', async () => {
    commerceAccessService.resolveViewStoreId.mockResolvedValue(18);
    prismaService.saleOrder.aggregate
      .mockResolvedValueOnce({
        _count: { id: 4 },
        _sum: {
          totalRevenue: new Prisma.Decimal('200'),
          totalProfit: new Prisma.Decimal('55'),
        },
      })
      .mockResolvedValueOnce({
        _count: { id: 2 },
        _sum: {
          totalRevenue: new Prisma.Decimal('160'),
          totalProfit: new Prisma.Decimal('44'),
        },
      });

    await expect(
      service.getStats(user, {
        storeId: 18,
        period: 'today',
      }),
    ).resolves.toEqual({
      totalRevenue: 200,
      totalProfit: 55,
      orderCount: 4,
      avgOrderValue: 50,
      compareLastPeriod: 25,
    });
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
        orderCount: 3,
        avgOrderValue: 16.5,
      },
      dailySales: [
        {
          id: `${new Date(2026, 4, 14, 0, 0, 0, 0).getTime()}-manual_手冲咖啡`,
          dateLabel: '05/14',
          productName: '手冲咖啡',
          quantity: 1,
          revenue: 23.5,
        },
        {
          id: `${new Date(2026, 4, 14, 0, 0, 0, 0).getTime()}-201`,
          dateLabel: '05/14',
          productName: '可口可乐 330ml',
          quantity: 2,
          revenue: 13,
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
        orderCount: 1,
        avgOrderValue: 19.5,
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

  it('create 会按商品主数据记账并联动库存与财务流水', async () => {
    const saleDate = new Date('2026-05-14T11:30:00.000Z');
    const createdAt = new Date('2026-05-14T11:35:00.000Z');

    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
    commerceAccessService.findOperatorStaffIdForStore.mockResolvedValue(8);
    prismaService.product.findMany.mockResolvedValue([
      {
        id: 201,
        name: '可口可乐 330ml',
        category: '饮品',
        code: 'COLA001',
        price: new Prisma.Decimal('15.50'),
        profit: new Prisma.Decimal('4.00'),
        stock: 20,
        isActive: true,
        image: 'https://example.com/coke.png',
      },
    ]);
    transactionClient.saleOrder.count.mockResolvedValue(3);
    transactionClient.saleOrder.create.mockResolvedValue({
      id: 11,
      storeId: 18,
      operatorStaffId: 8,
      orderNo: '#20260514-004',
      totalRevenue: new Prisma.Decimal('49'),
      totalProfit: new Prisma.Decimal('13'),
      totalQuantity: 3,
      paymentMethod: 'cash',
      calcMode: 'business',
      note: '补录',
      date: saleDate,
      createdAt,
      updatedAt: createdAt,
      items: [
        {
          id: 101,
          orderId: 11,
          storeId: 18,
          productId: 201,
          productName: '可口可乐 330ml',
          categoryName: '饮品',
          salePrice: new Prisma.Decimal('15.5'),
          profit: new Prisma.Decimal('4'),
          quantity: 2,
          image: 'https://example.com/coke.png',
          createdAt,
        },
        {
          id: 102,
          orderId: 11,
          storeId: 18,
          productId: null,
          productName: '手冲咖啡',
          categoryName: '饮品',
          salePrice: new Prisma.Decimal('18'),
          profit: new Prisma.Decimal('5'),
          quantity: 1,
          image: null,
          createdAt,
        },
      ],
    });

    await expect(
      service.create(user, {
        storeId: 18,
        items: [
          {
            productId: '201',
            productName: '前端旧名称',
            categoryName: '前端旧分类',
            salePrice: 15.5,
            profit: 4,
            quantity: 2,
          },
          {
            productId: 'manual_1',
            productName: '手冲咖啡',
            categoryName: '饮品',
            salePrice: 18,
            profit: 5,
            quantity: 1,
          },
        ],
        totalRevenue: 49,
        totalProfit: 13,
        totalQuantity: 3,
        paymentMethod: 'cash',
        calcMode: 'business',
        note: '补录',
        date: saleDate.getTime(),
      }),
    ).resolves.toEqual({
      id: '11',
      orderNo: '#20260514-004',
      items: [
        {
          productId: '201',
          productName: '可口可乐 330ml',
          categoryName: '饮品',
          salePrice: 15.5,
          profit: 4,
          quantity: 2,
        },
        {
          productId: 'manual_102',
          productName: '手冲咖啡',
          categoryName: '饮品',
          salePrice: 18,
          profit: 5,
          quantity: 1,
        },
      ],
      totalRevenue: 49,
      totalProfit: 13,
      totalQuantity: 3,
      paymentMethod: 'cash',
      calcMode: 'business',
      note: '补录',
      date: saleDate.getTime(),
      createdAt: createdAt.getTime(),
    });

    expect(inventoryService.recordSaleDeduction).toHaveBeenCalledWith(
      transactionClient,
      {
        storeId: 18,
        saleOrderId: 11,
        operatorStaffId: 8,
        items: [{ productId: 201, quantity: 2 }],
      },
    );
    expect(transactionClient.financeCashFlowRecord.create).toHaveBeenCalledWith(
      {
        data: expect.objectContaining({
          storeId: 18,
          saleOrderId: 11,
          direction: 'income',
          category: 'sales',
          amount: new Prisma.Decimal('49'),
          payment: 'cash',
        }),
      },
    );
  });

  it('create 支持负数抵扣项且不计入总销售件数', async () => {
    const saleDate = new Date('2026-05-14T12:30:00.000Z');
    const createdAt = new Date('2026-05-14T12:35:00.000Z');

    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
    commerceAccessService.findOperatorStaffIdForStore.mockResolvedValue(8);
    prismaService.product.findMany.mockResolvedValue([
      {
        id: 201,
        name: '包间台位费',
        category: '场地费',
        code: 'ROOM001',
        price: new Prisma.Decimal('100.00'),
        profit: new Prisma.Decimal('100.00'),
        stock: 10,
        isActive: true,
        image: null,
      },
    ]);
    transactionClient.saleOrder.count.mockResolvedValue(4);
    transactionClient.saleOrder.create.mockResolvedValue({
      id: 12,
      storeId: 18,
      operatorStaffId: 8,
      orderNo: '#20260514-005',
      totalRevenue: new Prisma.Decimal('70'),
      totalProfit: new Prisma.Decimal('70'),
      totalQuantity: 1,
      paymentMethod: 'cash',
      calcMode: 'business',
      note: '续费抵扣后结账',
      date: saleDate,
      createdAt,
      updatedAt: createdAt,
      items: [
        {
          id: 103,
          orderId: 12,
          storeId: 18,
          productId: 201,
          productName: '包间台位费',
          categoryName: '场地费',
          salePrice: new Prisma.Decimal('100'),
          profit: new Prisma.Decimal('100'),
          quantity: 1,
          image: null,
          createdAt,
        },
        {
          id: 104,
          orderId: 12,
          storeId: 18,
          productId: null,
          productName: '续费抵扣',
          categoryName: '场地费',
          salePrice: new Prisma.Decimal('-30'),
          profit: new Prisma.Decimal('-30'),
          quantity: 1,
          image: null,
          createdAt,
        },
      ],
    });

    await expect(
      service.create(user, {
        storeId: 18,
        items: [
          {
            productId: '201',
            productName: '旧台位费名称',
            categoryName: '旧分类',
            salePrice: 100,
            profit: 100,
            quantity: 1,
          },
          {
            productId: 'SYS_RENEW_DEDUCTION',
            productName: '续费抵扣',
            categoryName: '场地费',
            salePrice: -30,
            profit: -30,
            quantity: 1,
          },
        ],
        totalRevenue: 70,
        totalProfit: 70,
        totalQuantity: 1,
        paymentMethod: 'cash',
        calcMode: 'business',
        note: '续费抵扣后结账',
        date: saleDate.getTime(),
      }),
    ).resolves.toEqual({
      id: '12',
      orderNo: '#20260514-005',
      items: [
        {
          productId: '201',
          productName: '包间台位费',
          categoryName: '场地费',
          salePrice: 100,
          profit: 100,
          quantity: 1,
        },
        {
          productId: 'manual_104',
          productName: '续费抵扣',
          categoryName: '场地费',
          salePrice: -30,
          profit: -30,
          quantity: 1,
        },
      ],
      totalRevenue: 70,
      totalProfit: 70,
      totalQuantity: 1,
      paymentMethod: 'cash',
      calcMode: 'business',
      note: '续费抵扣后结账',
      date: saleDate.getTime(),
      createdAt: createdAt.getTime(),
    });

    expect(inventoryService.recordSaleDeduction).toHaveBeenCalledWith(
      transactionClient,
      {
        storeId: 18,
        saleOrderId: 12,
        operatorStaffId: 8,
        items: [{ productId: 201, quantity: 1 }],
      },
    );
    expect(transactionClient.financeCashFlowRecord.create).toHaveBeenCalledWith(
      {
        data: expect.objectContaining({
          storeId: 18,
          saleOrderId: 12,
          direction: 'income',
          category: 'sales',
          amount: new Prisma.Decimal('70'),
          payment: 'cash',
        }),
      },
    );
  });

  it('create 在手动抵扣项销售额和利润异号时抛出 BadRequestException', async () => {
    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
    commerceAccessService.findOperatorStaffIdForStore.mockResolvedValue(8);
    prismaService.product.findMany.mockResolvedValue([]);

    await expect(
      service.create(user, {
        storeId: 18,
        items: [
          {
            productId: 'SYS_RENEW_DEDUCTION',
            productName: '续费抵扣',
            categoryName: '场地费',
            salePrice: -20,
            profit: 20,
            quantity: 1,
          },
        ],
        totalRevenue: -20,
        totalProfit: 20,
        totalQuantity: 0,
        paymentMethod: 'cash',
        calcMode: 'business',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('create 在汇总金额与后端商品单价不一致时抛出 BadRequestException', async () => {
    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
    commerceAccessService.findOperatorStaffIdForStore.mockResolvedValue(8);
    prismaService.product.findMany.mockResolvedValue([
      {
        id: 201,
        name: '可口可乐 330ml',
        category: '饮品',
        code: 'COLA001',
        price: new Prisma.Decimal('15.50'),
        profit: new Prisma.Decimal('4.00'),
        stock: 20,
        isActive: true,
        image: null,
      },
    ]);

    await expect(
      service.create(user, {
        storeId: 18,
        items: [
          {
            productId: '201',
            productName: '可口可乐 330ml',
            categoryName: '饮品',
            salePrice: 10,
            profit: 2,
            quantity: 1,
          },
        ],
        totalRevenue: 10,
        totalProfit: 2,
        totalQuantity: 1,
        paymentMethod: 'cash',
        calcMode: 'business',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('remove 会回滚库存和财务流水后删除记录', async () => {
    prismaService.saleOrder.findUnique.mockResolvedValue({
      id: 11,
      storeId: 18,
    });

    await service.remove(user, 11);

    expect(commerceAccessService.ensureCanAccessStore).toHaveBeenCalledWith(
      user,
      18,
      'sales:delete',
      '无权删除该销售记录',
    );
    expect(inventoryService.revertSaleDeduction).toHaveBeenCalledWith(
      transactionClient,
      {
        storeId: 18,
        saleOrderId: 11,
      },
    );
    expect(
      transactionClient.financeCashFlowRecord.deleteMany,
    ).toHaveBeenCalledWith({
      where: { storeId: 18, saleOrderId: 11 },
    });
    expect(transactionClient.saleOrder.delete).toHaveBeenCalledWith({
      where: { id: 11 },
    });
  });

  it('remove 在记录不存在时抛出 NotFoundException', async () => {
    prismaService.saleOrder.findUnique.mockResolvedValue(null);

    await expect(service.remove(user, 999)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
