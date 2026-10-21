import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PlatformMembershipAccessService } from '../../member/platform-membership/platform-membership-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { ProductsService } from '../products/products.service';
import { InventoryReadService } from './inventory-read.service';
import { InventoryService } from './inventory.service';

describe('InventoryService', () => {
  let service: InventoryService;
  let readService: InventoryReadService;

  const prismaService = {
    inventoryAdjustmentLog: {
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      /** 批量写库存调整流水（补货/销售扣减等返回值被丢弃的路径） */
      createMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    product: {
      findFirst: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    // 客存冻结聚合：默认无冻结量，未开启 frozen 的门店行为不变
    custodyOrder: {
      groupBy: jest.fn().mockResolvedValue([]),
    },
    // 盘点行锁 SELECT ... FOR UPDATE
    $queryRaw: jest.fn().mockResolvedValue([]),
    // 批量库存 UPDATE（多个商品合并为一条 SQL）
    $executeRaw: jest.fn().mockResolvedValue(0),
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

  const platformMembershipAccessService = {
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
    jest.clearAllMocks();
    platformMembershipAccessService.ensureReportExportEnabled.mockResolvedValue(
      undefined,
    );
    /* 盘点调整用「加锁 + 读库存」合并查询取商品行，默认查不到 */
    prismaService.$queryRaw.mockResolvedValue([]);
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
        InventoryReadService,
        { provide: PrismaService, useValue: prismaService },
        { provide: CommerceAccessService, useValue: commerceAccessService },
        { provide: ConfigService, useValue: configService },
        { provide: ProductsService, useValue: productsService },
        {
          provide: PlatformMembershipAccessService,
          useValue: platformMembershipAccessService,
        },
      ],
    }).compile();

    service = module.get<InventoryService>(InventoryService);
    readService = module.get<InventoryReadService>(InventoryReadService);
  });

  it('listProducts 会返回分页结构并按筛选排序后的结果计 total', async () => {
    const createdAt = new Date('2026-05-14T09:00:00.000Z');
    const updatedAt = new Date('2026-05-14T10:00:00.000Z');

    commerceAccessService.resolveViewStoreId.mockResolvedValue(18);
    prismaService.product.findMany.mockResolvedValue([
      {
        id: 101,
        name: '雪碧',
        category: '饮品',
        code: 'SP001',
        price: { toString: () => '450' },
        profit: { toString: () => '150' },
        costPrice: { toString: () => '300' },
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
        price: { toString: () => '500' },
        profit: { toString: () => '180' },
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
        price: { toString: () => '800' },
        profit: { toString: () => '200' },
        costPrice: null,
        unit: '包',
        stock: 20,
        alertThreshold: 5,
        image: null,
        createdAt,
        updatedAt,
      },
    ]);
    prismaService.product.count.mockResolvedValue(3);
    /*
     * alertOnly 走 raw SQL 下推：库存 <= 阈值的行由数据库过滤后返回，
     * 这里模拟「薯片（库存 20 > 阈值 5）已被库内过滤掉」的结果。
     */
    prismaService.$queryRaw.mockResolvedValue([
      {
        id: 101,
        name: '雪碧',
        category: '饮品',
        code: 'SP001',
        price: 450,
        profit: 150,
        costPrice: 300,
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
        price: 500,
        profit: 180,
        costPrice: null,
        unit: '瓶',
        stock: 0,
        alertThreshold: 3,
        image: 'https://img.example.com/cola.png',
        createdAt,
        updatedAt,
      },
    ]);

    await expect(
      readService.listProducts(user, {
        storeId: 18,
        keyword: '0',
        alertOnly: true,
        sortBy: 'alert',
        page: 1,
        pageSize: 10,
      }),
    ).resolves.toEqual({
      items: [
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
      ],
      meta: {
        page: 1,
        pageSize: 10,
        total: 2,
        totalPages: 1,
      },
    });

    /* 预警筛选下推到 raw SQL，不再用 Prisma findMany 全量加载 */
    expect(prismaService.$queryRaw).toHaveBeenCalled();
    expect(prismaService.product.findMany).not.toHaveBeenCalled();
    /* D8 优化：有域层筛选时回退内存分页，不再执行冗余 COUNT 查询 */
    expect(prismaService.product.count).not.toHaveBeenCalled();
  });

  it('listProducts 在无门店权限时返回空分页结构', async () => {
    commerceAccessService.resolveViewStoreId.mockResolvedValue(null);

    await expect(
      readService.listProducts(user, { page: 2, pageSize: 5 }),
    ).resolves.toEqual({
      items: [],
      meta: {
        page: 2,
        pageSize: 5,
        total: 0,
        totalPages: 1,
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
      readService.listAdjustments(user, {
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
  });

  it('adjust 会把门店、操作人和归一化 mode 交给事务库存调整逻辑', async () => {
    const createdAt = new Date('2026-05-14T11:00:00.000Z');

    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
    commerceAccessService.findOperatorStaffIdForStore.mockResolvedValue(8);
    /* 加锁与读库存合并为一次查询：这里直接返回商品行 */
    prismaService.$queryRaw.mockResolvedValue([
      { id: 101, name: '可口可乐 330ml', stock: 10 },
    ]);
    prismaService.inventoryAdjustmentLog.create.mockResolvedValue({
      id: 31,
      productId: 101,
      productName: '可口可乐 330ml',
      beforeStock: 10,
      afterStock: 15,
      delta: 5,
      adjustType: 'manual',
      note: '盘点修正',
      purchaseOrderId: null,
      createdAt,
    });
    prismaService.product.update.mockResolvedValue({
      id: 101,
      name: '可口可乐 330ml',
      stock: 15,
    });

    await expect(
      service.adjust(user, {
        storeId: 18,
        productId: 101,
        delta: 5,
        adjustType: 'manual',
        note: '盘点修正',
      }),
    ).resolves.toEqual({
      id: '31',
      productId: '101',
      productName: '可口可乐 330ml',
      beforeStock: 10,
      afterStock: 15,
      delta: 5,
      adjustType: 'manual',
      note: '盘点修正',
      createdAt: createdAt.getTime(),
    });
  });

  /*
   * 回归用：调整类型与变动方向必须一致，否则会写出「进货入库 -7」「损耗/报废 +95」
   * 这类语义自相矛盾的流水，按 adjustType 聚合的库存报表无法解释。
   */
  it('adjust 拒绝与调整类型方向不一致的增减量', async () => {
    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);

    await expect(
      service.adjust(user, {
        storeId: 18,
        productId: 101,
        delta: -7,
        adjustType: 'restock',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.adjust(user, {
        storeId: 18,
        productId: 101,
        delta: 95,
        adjustType: 'damage',
        note: '报废说明',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('adjust 报损类型缺少有效备注时拒绝', async () => {
    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);

    await expect(
      service.adjust(user, {
        storeId: 18,
        productId: 101,
        delta: -3,
        adjustType: 'damage',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.adjust(user, {
        storeId: 18,
        productId: 101,
        delta: -3,
        adjustType: 'damage',
        note: '   ',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('getReport 在导出场景会校验会员导出权限', async () => {
    const createdAt = new Date('2026-05-14T09:00:00.000Z');
    const updatedAt = new Date('2026-05-14T10:00:00.000Z');

    commerceAccessService.resolveViewStoreId.mockResolvedValue(18);
    prismaService.product.findMany.mockResolvedValue([
      {
        id: 102,
        name: '可乐',
        category: '饮品',
        code: 'KL001',
        price: { toString: () => '500' },
        profit: { toString: () => '180' },
        costPrice: null,
        unit: '瓶',
        stock: 0,
        alertThreshold: 3,
        image: null,
        createdAt,
        updatedAt,
      },
    ]);
    prismaService.product.count.mockResolvedValue(1);

    await readService.getReport(user, {
      storeId: 18,
      export: true,
      page: 1,
      pageSize: 10,
    });

    expect(
      platformMembershipAccessService.ensureReportExportEnabled,
    ).toHaveBeenCalledWith(18, false);
  });

  it('getReport 导出权限不足时抛出 ForbiddenException', async () => {
    commerceAccessService.resolveViewStoreId.mockResolvedValue(18);
    platformMembershipAccessService.ensureReportExportEnabled.mockRejectedValue(
      new ForbiddenException('当前套餐暂不支持导出报表'),
    );

    await expect(
      readService.getReport(user, {
        storeId: 18,
        export: true,
        page: 1,
        pageSize: 10,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('recordPurchaseRestock 会委托库存入库事务逻辑', async () => {
    const params = {
      storeId: 18,
      purchaseOrderId: 77,
      operatorStaffId: 8,
      items: [
        { productId: 101, quantity: 3 },
        { productId: 102, quantity: 5 },
      ],
    };

    prismaService.product.findMany.mockResolvedValue([
      { id: 101, name: '可乐', stock: 10 },
      { id: 102, name: '雪碧', stock: 20 },
    ]);
    prismaService.product.update.mockResolvedValue({});
    prismaService.inventoryAdjustmentLog.create.mockResolvedValue({});

    await expect(
      service.recordPurchaseRestock(
        prismaService as unknown as Prisma.TransactionClient,
        params,
      ),
    ).resolves.toBeUndefined();
  });
});
