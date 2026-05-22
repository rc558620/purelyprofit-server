import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { ProductsService } from '../products/products.service';
import { InventoryService } from './inventory.service';

describe('InventoryService', () => {
  let service: InventoryService;

  const prismaService = {
    inventoryAdjustmentLog: {
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
    },
    product: {
      findFirst: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
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

  const configService = {
    get: jest.fn(),
  };

  const productsService = {
    remove: jest.fn(),
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
        InventoryService,
        { provide: PrismaService, useValue: prismaService },
        { provide: CommerceAccessService, useValue: commerceAccessService },
        { provide: ConfigService, useValue: configService },
        { provide: ProductsService, useValue: productsService },
      ],
    }).compile();

    service = module.get<InventoryService>(InventoryService);
  });

  it('listProducts 会按库存盘点筛选条件和排序返回商品列表', async () => {
    const createdAt = new Date('2026-05-14T09:00:00.000Z');
    const updatedAt = new Date('2026-05-14T10:00:00.000Z');

    commerceAccessService.resolveViewStoreId.mockResolvedValue(18);
    prismaService.product.findMany.mockResolvedValue([
      {
        id: 101,
        name: '雪碧',
        category: '饮品',
        code: 'SP001',
        price: { toString: () => '4.50' },
        profit: { toString: () => '1.50' },
        costPrice: { toString: () => '3.00' },
        unit: '瓶',
        stock: 2,
        alertThreshold: 3,
        image: null,
        createdAt,
        updatedAt,
      },
      {
        id: 102,
        name: '可乐',
        category: '饮品',
        code: 'KL001',
        price: { toString: () => '5.00' },
        profit: { toString: () => '1.80' },
        costPrice: null,
        unit: '瓶',
        stock: 0,
        alertThreshold: 3,
        image: 'https://img.example.com/cola.png',
        createdAt,
        updatedAt,
      },
      {
        id: 103,
        name: '薯片',
        category: '零食',
        code: 'SP002',
        price: { toString: () => '8.00' },
        profit: { toString: () => '2.00' },
        costPrice: null,
        unit: '包',
        stock: 20,
        alertThreshold: 5,
        image: null,
        createdAt,
        updatedAt,
      },
    ]);

    await expect(
      service.listProducts(user, {
        storeId: 18,
        keyword: '0',
        alertOnly: true,
        sortBy: 'alert',
      }),
    ).resolves.toEqual([
      {
        id: '102',
        name: '可乐',
        category: '饮品',
        code: 'KL001',
        price: 5,
        profit: 1.8,
        unit: '瓶',
        stock: 0,
        alertThreshold: 3,
        alertLevel: 'danger',
        image: 'https://img.example.com/cola.png',
        createdAt: createdAt.getTime(),
        updatedAt: updatedAt.getTime(),
      },
      {
        id: '101',
        name: '雪碧',
        category: '饮品',
        code: 'SP001',
        price: 4.5,
        profit: 1.5,
        costPrice: 3,
        unit: '瓶',
        stock: 2,
        alertThreshold: 3,
        alertLevel: 'warning',
        createdAt: createdAt.getTime(),
        updatedAt: updatedAt.getTime(),
      },
    ]);

    expect(prismaService.product.findMany).toHaveBeenCalledWith({
      where: {
        storeId: 18,
        isActive: true,
        OR: [
          {
            name: {
              contains: '0',
              mode: 'insensitive',
            },
          },
          {
            code: {
              contains: '0',
              mode: 'insensitive',
            },
          },
        ],
      },
      select: {
        id: true,
        name: true,
        category: true,
        code: true,
        price: true,
        profit: true,
        costPrice: true,
        unit: true,
        stock: true,
        alertThreshold: true,
        image: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  });

  it('removeProduct 会复用商品删除逻辑', async () => {
    await expect(service.removeProduct(user, 101)).resolves.toBeUndefined();

    expect(productsService.remove).toHaveBeenCalledWith(user, 101);
  });

  it('listAdjustments 会按筛选条件分页查询并映射返回', async () => {
    const createdAt = new Date('2026-05-14T10:00:00.000Z');

    commerceAccessService.resolveViewStoreId.mockResolvedValue(18);
    prismaService.inventoryAdjustmentLog.findMany.mockResolvedValue([
      {
        id: 21,
        storeId: 18,
        productId: 101,
        productName: '可口可乐 330ml',
        beforeStock: 10,
        afterStock: 15,
        delta: 5,
        adjustType: 'restock',
        note: '补货入库',
        purchaseOrderId: 88,
        createdAt,
      },
    ]);
    prismaService.inventoryAdjustmentLog.count.mockResolvedValue(12);

    await expect(
      service.listAdjustments(user, {
        storeId: 18,
        productId: 101,
        adjustType: 'restock',
        keyword: '可乐',
        page: 2,
        pageSize: 5,
      }),
    ).resolves.toEqual({
      items: [
        {
          id: '21',
          productId: '101',
          productName: '可口可乐 330ml',
          beforeStock: 10,
          afterStock: 15,
          delta: 5,
          adjustType: 'restock',
          note: '补货入库',
          purchaseOrderId: '88',
          createdAt: createdAt.getTime(),
        },
      ],
      meta: {
        page: 2,
        pageSize: 5,
        total: 12,
        totalPages: 3,
      },
    });

    expect(prismaService.inventoryAdjustmentLog.findMany).toHaveBeenCalledWith({
      where: {
        storeId: 18,
        productId: 101,
        adjustType: 'restock',
        productName: {
          contains: '可乐',
          mode: 'insensitive',
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: 5,
      take: 5,
    });
  });

  it('adjust 会在库存不足时截断到 0 并记录实际调整量', async () => {
    const createdAt = new Date('2026-05-14T11:00:00.000Z');

    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
    commerceAccessService.findOperatorStaffIdForStore.mockResolvedValue(8);
    prismaService.product.findFirst.mockResolvedValue({
      id: 101,
      storeId: 18,
      name: '可口可乐 330ml',
      stock: 3,
    });
    prismaService.product.update.mockResolvedValue({
      id: 101,
      stock: 0,
    });
    prismaService.inventoryAdjustmentLog.create.mockResolvedValue({
      id: 31,
      storeId: 18,
      productId: 101,
      productName: '可口可乐 330ml',
      beforeStock: 3,
      afterStock: 0,
      delta: -3,
      adjustType: 'manual',
      note: '盘点修正',
      purchaseOrderId: null,
      createdAt,
    });

    await expect(
      service.adjust(user, {
        storeId: 18,
        productId: 101,
        delta: -5,
        adjustType: 'manual',
        note: '  盘点修正  ',
      }),
    ).resolves.toEqual({
      id: '31',
      productId: '101',
      productName: '可口可乐 330ml',
      beforeStock: 3,
      afterStock: 0,
      delta: -3,
      adjustType: 'manual',
      note: '盘点修正',
      createdAt: createdAt.getTime(),
    });

    expect(prismaService.product.update).toHaveBeenCalledWith({
      where: { id: 101 },
      data: { stock: 0 },
    });
    expect(prismaService.inventoryAdjustmentLog.create).toHaveBeenCalledWith({
      data: {
        storeId: 18,
        productId: 101,
        operatorStaffId: 8,
        productName: '可口可乐 330ml',
        beforeStock: 3,
        afterStock: 0,
        delta: -3,
        adjustType: 'manual',
        note: '盘点修正',
      },
    });
  });

  it('adjust 在 set 模式下会直接设置盘点后库存并记录真实变化量', async () => {
    const createdAt = new Date('2026-05-14T12:00:00.000Z');

    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
    commerceAccessService.findOperatorStaffIdForStore.mockResolvedValue(8);
    prismaService.product.findFirst.mockResolvedValue({
      id: 101,
      storeId: 18,
      name: '可口可乐 330ml',
      stock: 12,
    });
    prismaService.product.update.mockResolvedValue({
      id: 101,
      stock: 20,
    });
    prismaService.inventoryAdjustmentLog.create.mockResolvedValue({
      id: 32,
      storeId: 18,
      productId: 101,
      productName: '可口可乐 330ml',
      beforeStock: 12,
      afterStock: 20,
      delta: 8,
      adjustType: 'manual',
      note: '盘点实存 20',
      purchaseOrderId: null,
      createdAt,
    });

    await expect(
      service.adjust(user, {
        storeId: 18,
        productId: 101,
        adjustType: 'manual',
        mode: 'set',
        targetStock: 20,
        note: '盘点实存 20',
      }),
    ).resolves.toEqual({
      id: '32',
      productId: '101',
      productName: '可口可乐 330ml',
      beforeStock: 12,
      afterStock: 20,
      delta: 8,
      adjustType: 'manual',
      note: '盘点实存 20',
      createdAt: createdAt.getTime(),
    });

    expect(prismaService.product.update).toHaveBeenCalledWith({
      where: { id: 101 },
      data: { stock: 20 },
    });
    expect(prismaService.inventoryAdjustmentLog.create).toHaveBeenCalledWith({
      data: {
        storeId: 18,
        productId: 101,
        operatorStaffId: 8,
        productName: '可口可乐 330ml',
        beforeStock: 12,
        afterStock: 20,
        delta: 8,
        adjustType: 'manual',
        note: '盘点实存 20',
      },
    });
  });

  it('updateAlertThreshold 会校验商品存在和门店权限后更新阈值', async () => {
    const updatedAt = new Date('2026-05-15T09:00:00.000Z');

    prismaService.product.findUnique.mockResolvedValue({
      id: 101,
      storeId: 18,
    });
    prismaService.product.update.mockResolvedValue({
      id: 101,
      alertThreshold: 6,
      updatedAt,
    });

    await expect(
      service.updateAlertThreshold(user, 101, { threshold: 6 }),
    ).resolves.toEqual({
      productId: '101',
      alertThreshold: 6,
      updatedAt: updatedAt.getTime(),
    });

    expect(commerceAccessService.ensureCanAccessStore).toHaveBeenCalledWith(
      user,
      18,
      'inventory:update',
      '无权操作该门店库存',
    );
  });

  it('getStats 会按库存状态统计并返回总货值', async () => {
    commerceAccessService.resolveViewStoreId.mockResolvedValue(18);
    prismaService.product.findMany.mockResolvedValue([
      { stock: 0, alertThreshold: 3, costPrice: new Prisma.Decimal('4.00') },
      { stock: 2, alertThreshold: 3, costPrice: new Prisma.Decimal('3.50') },
      { stock: 8, alertThreshold: 3, costPrice: null },
    ]);

    await expect(service.getStats(user, 18)).resolves.toEqual({
      totalSkuCount: 3,
      warningCount: 1,
      dangerCount: 1,
      normalCount: 1,
      totalStockValue: 7,
    });
  });

  it('getReport 会返回带 alertLevel 的库存报表商品明细', async () => {
    const createdAt = new Date('2026-05-14T09:00:00.000Z');
    const updatedAt = new Date('2026-05-14T10:00:00.000Z');

    commerceAccessService.resolveViewStoreId.mockResolvedValue(18);
    prismaService.product.findMany
      .mockResolvedValueOnce([
        {
          stock: 0,
          alertThreshold: 3,
          costPrice: new Prisma.Decimal('4.00'),
        },
        {
          stock: 2,
          alertThreshold: 3,
          costPrice: new Prisma.Decimal('3.50'),
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 102,
          name: '可乐',
          category: '饮品',
          code: 'KL001',
          price: { toString: () => '5.00' },
          profit: { toString: () => '1.80' },
          costPrice: null,
          unit: '瓶',
          stock: 0,
          alertThreshold: 3,
          image: null,
          createdAt,
          updatedAt,
        },
        {
          id: 101,
          name: '雪碧',
          category: '饮品',
          code: 'SP001',
          price: { toString: () => '4.50' },
          profit: { toString: () => '1.50' },
          costPrice: { toString: () => '3.00' },
          unit: '瓶',
          stock: 2,
          alertThreshold: 3,
          image: null,
          createdAt,
          updatedAt,
        },
      ]);

    await expect(service.getReport(user, { storeId: 18 })).resolves.toEqual({
      summary: {
        totalSkuCount: 2,
        warningCount: 1,
        dangerCount: 1,
        normalCount: 0,
        totalStockValue: 7,
      },
      products: [
        {
          id: '102',
          name: '可乐',
          category: '饮品',
          code: 'KL001',
          price: 5,
          profit: 1.8,
          unit: '瓶',
          stock: 0,
          alertThreshold: 3,
          alertLevel: 'danger',
          createdAt: createdAt.getTime(),
          updatedAt: updatedAt.getTime(),
        },
        {
          id: '101',
          name: '雪碧',
          category: '饮品',
          code: 'SP001',
          price: 4.5,
          profit: 1.5,
          costPrice: 3,
          unit: '瓶',
          stock: 2,
          alertThreshold: 3,
          alertLevel: 'warning',
          createdAt: createdAt.getTime(),
          updatedAt: updatedAt.getTime(),
        },
      ],
    });
  });

  it('recordPurchaseRestock 会批量增加库存并写入补货日志', async () => {
    const transaction = {
      product: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      inventoryAdjustmentLog: {
        create: jest.fn(),
      },
    } as unknown as Prisma.TransactionClient;

    const transactionProduct = transaction.product as {
      findFirst: jest.Mock;
      update: jest.Mock;
    };
    const transactionLog = transaction.inventoryAdjustmentLog as {
      create: jest.Mock;
    };

    transactionProduct.findFirst.mockResolvedValue({
      id: 101,
      storeId: 18,
      name: '可口可乐 330ml',
      stock: 10,
    });

    await service.recordPurchaseRestock(transaction, {
      storeId: 18,
      purchaseOrderId: 88,
      operatorStaffId: 8,
      items: [{ productId: 101, quantity: 5 }],
    });

    expect(transactionProduct.update).toHaveBeenCalledWith({
      where: { id: 101 },
      data: { stock: 15 },
    });
    expect(transactionLog.create).toHaveBeenCalledWith({
      data: {
        storeId: 18,
        productId: 101,
        purchaseOrderId: 88,
        operatorStaffId: 8,
        productName: '可口可乐 330ml',
        beforeStock: 10,
        afterStock: 15,
        delta: 5,
        adjustType: 'restock',
      },
    });
  });

  it('recordPurchaseRestock 在商品不存在时抛出 NotFoundException', async () => {
    const transaction = {
      product: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
      },
      inventoryAdjustmentLog: {
        create: jest.fn(),
      },
    } as unknown as Prisma.TransactionClient;

    await expect(
      service.recordPurchaseRestock(transaction, {
        storeId: 18,
        purchaseOrderId: 88,
        operatorStaffId: 8,
        items: [{ productId: 999, quantity: 5 }],
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
