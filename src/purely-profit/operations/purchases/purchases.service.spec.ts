import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { CostsService } from '../costs/costs.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../../redis/invalidator';
import { PurchasesService } from './purchases.service';

describe('PurchasesService', () => {
  let service: PurchasesService;

  const prismaService = {
    purchaseOrder: {
      findMany: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
    },
    supplier: {
      count: jest.fn(),
      findFirst: jest.fn(),
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

  const costsService = {
    syncPurchaseCost: jest.fn(),
    deletePurchaseCostRecord: jest.fn(),
  };

  const configService = {
    get: jest.fn(),
  };

  const cacheInvalidatorService = {
    invalidateProfitDashboardHome: jest.fn().mockResolvedValue(undefined),
    invalidatePulseDashboardOverview: jest.fn().mockResolvedValue(undefined),
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

  function createPurchaseOrder(overrides?: Record<string, unknown>) {
    const date = new Date('2026-05-14T10:00:00.000Z');
    const createdAt = new Date('2026-05-14T12:00:00.000Z');

    return {
      id: 11,
      storeId: 18,
      supplierId: 6,
      supplierName: '可口可乐供应商',
      operatorStaffId: 8,
      totalAmount: new Prisma.Decimal('72'),
      date,
      note: '门店周补货',
      createdAt,
      updatedAt: createdAt,
      items: [
        {
          id: 101,
          orderId: 11,
          storeId: 18,
          productId: 201,
          productName: '可口可乐 330ml 快照',
          unit: '箱',
          quantity: 6,
          unitPrice: new Prisma.Decimal('12'),
          amount: new Prisma.Decimal('72'),
          createdAt,
        },
      ],
      ...overrides,
    };
  }

  beforeEach(async () => {
    jest.clearAllMocks();

    configService.get.mockImplementation((key: string) => {
      const configMap: Record<string, number> = {
        'app.defaultPageSize': 10,
        'app.maxPageSize': 50,
      };
      return configMap[key];
    });

    prismaService.$transaction.mockImplementation(
      async (callback: (tx: typeof prismaService) => Promise<unknown>) =>
        callback(prismaService),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PurchasesService,
        { provide: PrismaService, useValue: prismaService },
        {
          provide: CacheInvalidatorService,
          useValue: cacheInvalidatorService,
        },
        { provide: CommerceAccessService, useValue: commerceAccessService },
        { provide: CostsService, useValue: costsService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<PurchasesService>(PurchasesService);
  });

  it('list 在无可访问门店时直接返回空分页并跳过查询', async () => {
    commerceAccessService.resolveViewStoreId.mockResolvedValue(null);

    await expect(
      service.list(user, {
        storeId: 18,
        page: 2,
        pageSize: 2,
      }),
    ).resolves.toEqual({
      items: [],
      meta: {
        page: 2,
        pageSize: 2,
        total: 0,
        totalPages: 1,
      },
    });

    expect(prismaService.purchaseOrder.findMany).not.toHaveBeenCalled();
    expect(prismaService.purchaseOrder.count).not.toHaveBeenCalled();
  });

  it('list 会先解析门店权限再查询订单列表', async () => {
    commerceAccessService.resolveViewStoreId.mockResolvedValue(18);
    prismaService.purchaseOrder.findMany.mockResolvedValue([
      createPurchaseOrder(),
    ]);
    prismaService.purchaseOrder.count.mockResolvedValue(6);

    const result = await service.list(user, {
      storeId: 18,
      period: 'month',
      page: 2,
      pageSize: 2,
    });

    expect(commerceAccessService.resolveViewStoreId).toHaveBeenCalledWith(
      user,
      18,
      'purchase:view',
      '无权查看该门店进货单',
    );
    expect(prismaService.purchaseOrder.findMany).toHaveBeenCalledTimes(1);
    expect(prismaService.purchaseOrder.count).toHaveBeenCalledTimes(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        id: '11',
        supplierName: '可口可乐供应商',
      }),
    );
    expect(result.meta).toEqual({
      page: 2,
      pageSize: 2,
      total: 6,
      totalPages: 3,
    });
  });

  it('getStats 在无可访问门店时直接返回空统计', async () => {
    commerceAccessService.resolveViewStoreId.mockResolvedValue(null);

    await expect(service.getStats(user, { storeId: 18 })).resolves.toEqual({
      totalAmount: 0,
      orderCount: 0,
      supplierCount: 0,
      compareLastPeriod: null,
    });

    expect(prismaService.supplier.count).not.toHaveBeenCalled();
    expect(prismaService.purchaseOrder.aggregate).not.toHaveBeenCalled();
  });

  it('getStats 会按当前门店编排供应商数和聚合统计', async () => {
    commerceAccessService.resolveViewStoreId.mockResolvedValue(18);
    // countPurchaseSuppliers 在有 where 参数时使用 findMany + distinct
    prismaService.purchaseOrder.findMany.mockResolvedValue([
      { supplierId: 1 },
      { supplierId: 2 },
      { supplierId: 3 },
    ]);
    prismaService.purchaseOrder.aggregate
      .mockResolvedValueOnce({
        _count: { id: 4 },
        _sum: { totalAmount: 20000 },
      })
      .mockResolvedValueOnce({
        _sum: { totalAmount: 16000 },
      });

    await expect(
      service.getStats(user, {
        storeId: 18,
        period: 'custom_month',
        customDate: new Date('2026-05-14T10:00:00.000Z').getTime(),
      }),
    ).resolves.toEqual({
      totalAmount: 200,
      orderCount: 4,
      supplierCount: 3,
      compareLastPeriod: 25,
    });

    expect(commerceAccessService.resolveViewStoreId).toHaveBeenCalledWith(
      user,
      18,
      'purchase:view',
      '无权查看该门店进货统计',
    );
    expect(prismaService.purchaseOrder.findMany).toHaveBeenCalledTimes(1);
    expect(prismaService.purchaseOrder.aggregate).toHaveBeenCalledTimes(2);
  });

  it('create 在 supplierId 存在但供应商不存在时抛出异常', async () => {
    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
    commerceAccessService.findOperatorStaffIdForStore.mockResolvedValue(8);
    prismaService.supplier.findFirst.mockResolvedValue(null);

    await expect(
      service.create(user, {
        storeId: 18,
        supplierId: 6,
        items: [
          {
            productId: 201,
            quantity: 2,
            unitPrice: 10,
          },
        ],
        date: new Date('2026-05-14T10:00:00.000Z').getTime(),
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(prismaService.product.findMany).not.toHaveBeenCalled();
    expect(prismaService.$transaction).not.toHaveBeenCalled();
  });

  it('create 会编排门店解析、事务创建与成本同步', async () => {
    const date = new Date('2026-05-14T10:00:00.000Z');

    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
    commerceAccessService.findOperatorStaffIdForStore.mockResolvedValue(8);
    prismaService.supplier.findFirst.mockResolvedValue({
      id: 6,
      name: '可口可乐供应商',
    });
    prismaService.product.findMany.mockResolvedValue([
      {
        id: 201,
        name: '可口可乐 330ml',
        unit: '瓶',
      },
    ]);
    prismaService.purchaseOrder.create.mockResolvedValue(createPurchaseOrder());

    const result = await service.create(user, {
      storeId: 18,
      supplierId: 6,
      items: [
        {
          productId: 201,
          productName: '可口可乐 330ml 快照',
          unit: '箱',
          quantity: 6,
          unitPrice: 12,
        },
      ],
      date: date.getTime(),
      note: '  门店周补货  ',
    });

    expect(commerceAccessService.resolveSingleStoreId).toHaveBeenCalledWith(
      user,
      18,
      'purchase:create',
      '无权操作该门店进货单',
    );
    expect(
      commerceAccessService.findOperatorStaffIdForStore,
    ).toHaveBeenCalledWith(user, 18);
    expect(prismaService.supplier.findFirst).toHaveBeenCalledTimes(1);
    expect(prismaService.product.findMany).toHaveBeenCalledTimes(1);
    expect(prismaService.$transaction).toHaveBeenCalledTimes(1);
    expect(prismaService.purchaseOrder.create).toHaveBeenCalledTimes(1);
    expect(costsService.syncPurchaseCost).toHaveBeenCalledWith(
      prismaService,
      expect.objectContaining({
        storeId: 18,
        purchaseOrderId: 11,
        operatorStaffId: 8,
        amount: 72,
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        id: '11',
        supplierId: '6',
        supplierName: '可口可乐供应商',
      }),
    );
  });

  it('create 在无码商品场景会跳过商品查询但仍走事务与成本同步', async () => {
    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
    commerceAccessService.findOperatorStaffIdForStore.mockResolvedValue(8);
    prismaService.purchaseOrder.create.mockResolvedValue(
      createPurchaseOrder({
        id: 12,
        supplierId: null,
        supplierName: '临时供应商',
        totalAmount: new Prisma.Decimal('36'),
        note: null,
        items: [
          {
            id: 102,
            orderId: 12,
            storeId: 18,
            productId: null,
            productName: '散装辣条',
            unit: null,
            quantity: 3,
            unitPrice: new Prisma.Decimal('12'),
            amount: new Prisma.Decimal('36'),
            createdAt: new Date('2026-05-15T12:00:00.000Z'),
          },
        ],
      }),
    );

    const result = await service.create(user, {
      storeId: 18,
      supplierName: '临时供应商',
      items: [
        {
          productName: '  散装辣条  ',
          quantity: 3,
          unitPrice: 12,
        },
      ],
      date: new Date('2026-05-15T10:00:00.000Z').getTime(),
    });

    expect(prismaService.product.findMany).not.toHaveBeenCalled();
    expect(prismaService.$transaction).toHaveBeenCalledTimes(1);
    expect(costsService.syncPurchaseCost).toHaveBeenCalledTimes(1);
    expect(result).toEqual(
      expect.objectContaining({
        id: '12',
        supplierName: '临时供应商',
      }),
    );
  });

  it('remove 在进货单不存在时抛出 NotFoundException', async () => {
    prismaService.purchaseOrder.findUnique.mockResolvedValue(null);

    await expect(service.remove(user, 11)).rejects.toBeInstanceOf(
      NotFoundException,
    );

    expect(commerceAccessService.ensureCanAccessStore).not.toHaveBeenCalled();
    expect(prismaService.purchaseOrder.delete).not.toHaveBeenCalled();
  });

  it('remove 会先校验门店权限，再在事务中删除成本记录和进货单', async () => {
    prismaService.purchaseOrder.findUnique.mockResolvedValue({
      id: 11,
      storeId: 18,
    });

    await expect(service.remove(user, 11)).resolves.toBeUndefined();

    expect(commerceAccessService.ensureCanAccessStore).toHaveBeenCalledWith(
      user,
      18,
      'purchase:delete',
      '无权删除该门店进货单',
    );
    expect(prismaService.$transaction).toHaveBeenCalledTimes(1);
    expect(costsService.deletePurchaseCostRecord).toHaveBeenCalledWith(
      prismaService,
      18,
      11,
    );
    expect(prismaService.purchaseOrder.delete).toHaveBeenCalledWith({
      where: { id: 11 },
    });
    // 验证缓存失效范围包含 Pulse
    expect(
      cacheInvalidatorService.invalidateProfitDashboardHome,
    ).toHaveBeenCalledWith(18);
    expect(
      cacheInvalidatorService.invalidatePulseDashboardOverview,
    ).toHaveBeenCalledWith(18);
  });
});
