import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../commerce/commerce-access.service';
import { CostsService } from '../costs/costs.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePurchaseDto } from './dto/purchase.dto';
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
  };

  const configService = {
    get: jest.fn(),
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

  it('CreatePurchaseDto 会忽略前端临时商品 ID 并通过校验', async () => {
    const dto = plainToInstance(CreatePurchaseDto, {
      supplierName: '312',
      items: [
        {
          productId: 'prd_1774853101784_1g62nev',
          productName: '可口可乐 330ml',
          unit: '瓶',
          quantity: 1,
          unitPrice: 2,
          amount: 2,
        },
      ],
      totalAmount: 2,
      date: 1779120000000,
    });

    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    expect(errors).toHaveLength(0);
    expect(dto.items[0]?.productId).toBeUndefined();
  });

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
        { provide: CommerceAccessService, useValue: commerceAccessService },
        { provide: CostsService, useValue: costsService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<PurchasesService>(PurchasesService);
  });

  it('list 会按日期范围和分页查询进货单并映射明细', async () => {
    const date = new Date('2026-05-14T10:00:00.000Z');
    const createdAt = new Date('2026-05-14T12:00:00.000Z');

    commerceAccessService.resolveViewStoreId.mockResolvedValue(18);
    prismaService.purchaseOrder.findMany.mockResolvedValue([
      {
        id: 11,
        storeId: 18,
        supplierId: 6,
        supplierName: '可口可乐供应商',
        operatorStaffId: 8,
        totalAmount: new Prisma.Decimal('150.50'),
        date,
        note: '周补货',
        createdAt,
        updatedAt: createdAt,
        items: [
          {
            id: 101,
            orderId: 11,
            storeId: 18,
            productId: 201,
            productName: '可口可乐 330ml',
            unit: '瓶',
            quantity: 10,
            unitPrice: new Prisma.Decimal('15.05'),
            amount: new Prisma.Decimal('150.50'),
            createdAt,
          },
        ],
      },
    ]);
    prismaService.purchaseOrder.count.mockResolvedValue(6);

    await expect(
      service.list(user, {
        storeId: 18,
        period: 'month',
        page: 2,
        pageSize: 2,
      }),
    ).resolves.toEqual({
      items: [
        {
          id: '11',
          supplierId: '6',
          supplierName: '可口可乐供应商',
          items: [
            {
              id: '101',
              productId: '201',
              productName: '可口可乐 330ml',
              unit: '瓶',
              quantity: 10,
              unitPrice: 15.05,
              amount: 150.5,
            },
          ],
          totalAmount: 150.5,
          date: date.getTime(),
          note: '周补货',
          createdAt: createdAt.getTime(),
        },
      ],
      meta: {
        page: 2,
        pageSize: 2,
        total: 6,
        totalPages: 3,
      },
    });

    expect(prismaService.purchaseOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          storeId: 18,
          date: expect.any(Object),
        }),
        orderBy: [{ date: 'desc' }, { id: 'desc' }],
        skip: 2,
        take: 2,
      }),
    );
  });

  it('getStats 会返回当前周期统计和上期对比', async () => {
    commerceAccessService.resolveViewStoreId.mockResolvedValue(18);
    prismaService.supplier.count.mockResolvedValue(3);
    prismaService.purchaseOrder.aggregate
      .mockResolvedValueOnce({
        _count: { id: 4 },
        _sum: { totalAmount: new Prisma.Decimal('200') },
      })
      .mockResolvedValueOnce({
        _sum: { totalAmount: new Prisma.Decimal('160') },
      });

    await expect(
      service.getStats(user, {
        storeId: 18,
        period: 'custom_month',
        customDate: new Date('2026-05-14T10:00:00.000Z').getTime(),
      }),
    ).resolves.toEqual({
      totalThisMonth: 200,
      countThisMonth: 4,
      supplierCount: 3,
      compareLastMonth: 25,
    });
  });

  it('create 在未提供 supplierId 和 supplierName 时抛出 BadRequestException', async () => {
    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
    commerceAccessService.findOperatorStaffIdForStore.mockResolvedValue(8);

    await expect(
      service.create(user, {
        storeId: 18,
        items: [
          {
            productId: 201,
            quantity: 2,
            unitPrice: 10,
          },
        ],
        date: new Date('2026-05-14T10:00:00.000Z').getTime(),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('create 在进货明细商品重复时抛出 ConflictException', async () => {
    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
    commerceAccessService.findOperatorStaffIdForStore.mockResolvedValue(8);

    await expect(
      service.create(user, {
        storeId: 18,
        supplierName: '临时供应商',
        items: [
          {
            productId: 201,
            quantity: 2,
            unitPrice: 10,
          },
          {
            productId: 201,
            quantity: 3,
            unitPrice: 12,
          },
        ],
        date: new Date('2026-05-14T10:00:00.000Z').getTime(),
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('create 会兼容前端金额字段并保存商品快照', async () => {
    const date = new Date('2026-05-14T10:00:00.000Z');
    const createdAt = new Date('2026-05-14T12:00:00.000Z');

    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
    commerceAccessService.findOperatorStaffIdForStore.mockResolvedValue(8);
    prismaService.supplier.findFirst.mockResolvedValue({
      id: 6,
      storeId: 18,
      name: '可口可乐供应商',
    });
    prismaService.product.findMany.mockResolvedValue([
      {
        id: 201,
        name: '可口可乐 330ml',
        unit: '瓶',
      },
    ]);
    prismaService.purchaseOrder.create.mockResolvedValue({
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
    });

    await expect(
      service.create(user, {
        storeId: 18,
        supplierId: 6,
        items: [
          {
            productId: 201,
            productName: '可口可乐 330ml 快照',
            unit: '箱',
            quantity: 6,
            unitPrice: 12,
            amount: 72,
          },
        ],
        totalAmount: 72,
        date: date.getTime(),
        note: '  门店周补货  ',
      }),
    ).resolves.toEqual({
      id: '11',
      supplierId: '6',
      supplierName: '可口可乐供应商',
      items: [
        {
          id: '101',
          productId: '201',
          productName: '可口可乐 330ml 快照',
          unit: '箱',
          quantity: 6,
          unitPrice: 12,
          amount: 72,
        },
      ],
      totalAmount: 72,
      date: date.getTime(),
      note: '门店周补货',
      createdAt: createdAt.getTime(),
    });

    expect(prismaService.purchaseOrder.create).toHaveBeenCalledWith({
      data: {
        storeId: 18,
        supplierId: 6,
        supplierName: '可口可乐供应商',
        operatorStaffId: 8,
        totalAmount: 72,
        date,
        note: '门店周补货',
        items: {
          create: [
            {
              storeId: 18,
              productId: 201,
              productName: '可口可乐 330ml 快照',
              unit: '箱',
              quantity: 6,
              unitPrice: 12,
              amount: 72,
            },
          ],
        },
      },
      include: {
        items: {
          orderBy: [{ id: 'asc' }],
        },
      },
    });
    expect(costsService.syncPurchaseCost).toHaveBeenCalledWith(
      prismaService,
      expect.objectContaining({
        storeId: 18,
        purchaseOrderId: 11,
        operatorStaffId: 8,
        amount: 72,
      }),
    );
  });

  it('create 支持无码商品并且返回时省略 productId', async () => {
    const date = new Date('2026-05-15T10:00:00.000Z');
    const createdAt = new Date('2026-05-15T12:00:00.000Z');

    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
    commerceAccessService.findOperatorStaffIdForStore.mockResolvedValue(8);
    prismaService.purchaseOrder.create.mockResolvedValue({
      id: 12,
      storeId: 18,
      supplierId: null,
      supplierName: '临时供应商',
      operatorStaffId: 8,
      totalAmount: new Prisma.Decimal('36'),
      date,
      note: null,
      createdAt,
      updatedAt: createdAt,
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
          createdAt,
        },
      ],
    });

    await expect(
      service.create(user, {
        storeId: 18,
        supplierName: '临时供应商',
        items: [
          {
            productName: '  散装辣条  ',
            quantity: 3,
            unitPrice: 12,
            amount: 36,
          },
        ],
        totalAmount: 36,
        date: date.getTime(),
      }),
    ).resolves.toEqual({
      id: '12',
      supplierName: '临时供应商',
      items: [
        {
          id: '102',
          productName: '散装辣条',
          quantity: 3,
          unitPrice: 12,
          amount: 36,
        },
      ],
      totalAmount: 36,
      date: date.getTime(),
      createdAt: createdAt.getTime(),
    });

    expect(prismaService.product.findMany).not.toHaveBeenCalled();
    expect(prismaService.purchaseOrder.create).toHaveBeenCalledWith({
      data: {
        storeId: 18,
        supplierId: null,
        supplierName: '临时供应商',
        operatorStaffId: 8,
        totalAmount: 36,
        date,
        note: null,
        items: {
          create: [
            {
              storeId: 18,
              productId: null,
              productName: '散装辣条',
              unit: null,
              quantity: 3,
              unitPrice: 12,
              amount: 36,
            },
          ],
        },
      },
      include: {
        items: {
          orderBy: [{ id: 'asc' }],
        },
      },
    });
  });

  it('remove 在进货单不存在时抛出 NotFoundException', async () => {
    prismaService.purchaseOrder.findUnique.mockResolvedValue(null);

    await expect(service.remove(user, 11)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('remove 会校验权限后删除进货单', async () => {
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
    expect(prismaService.purchaseOrder.delete).toHaveBeenCalledWith({
      where: { id: 11 },
    });
  });
});
