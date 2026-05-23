import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PlatformMembershipAccessService } from '../../member/platform-membership/platform-membership-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { ProductsService } from './products.service';

describe('ProductsService', () => {
  let service: ProductsService;

  const prismaService = {
    product: {
      create: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    productCategory: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
  };

  const configService = {
    get: jest.fn(),
  };

  const commerceAccessService = {
    resolveSingleStoreId: jest.fn(),
    resolveViewStoreId: jest.fn(),
    ensureCanAccessStore: jest.fn(),
  };

  const platformMembershipAccessService = {
    ensureProductQuotaAvailable: jest.fn(),
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: PrismaService, useValue: prismaService },
        { provide: ConfigService, useValue: configService },
        { provide: CommerceAccessService, useValue: commerceAccessService },
        {
          provide: PlatformMembershipAccessService,
          useValue: platformMembershipAccessService,
        },
      ],
    }).compile();

    service = module.get<ProductsService>(ProductsService);
  });

  it('create 会在新增商品前校验会员商品额度', async () => {
    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
    platformMembershipAccessService.ensureProductQuotaAvailable.mockRejectedValue(
      new ForbiddenException(
        '当前会员套餐最多可录入 3 个商品，请升级会员后继续添加',
      ),
    );

    await expect(
      service.create(user, {
        storeId: 18,
        category: '饮品',
        code: 'SKU-001',
        name: '可乐',
        price: 500,
        profit: 200,
        costPrice: 300,
        unit: '瓶',
        stock: 10,
        alertThreshold: 3,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(
      platformMembershipAccessService.ensureProductQuotaAvailable,
    ).toHaveBeenCalledWith(18);
    expect(prismaService.product.create).not.toHaveBeenCalled();
  });

  it('create 在额度校验通过后正常创建商品', async () => {
    commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
    platformMembershipAccessService.ensureProductQuotaAvailable.mockResolvedValue(
      undefined,
    );
    prismaService.productCategory.findFirst.mockResolvedValue({ id: 7 });
    prismaService.product.findFirst.mockResolvedValue(null);
    prismaService.product.create.mockResolvedValue({
      id: 11,
      name: '可乐',
      category: '饮品',
      code: 'SKU-001',
      price: new Prisma.Decimal('500'),
      profit: new Prisma.Decimal('200'),
      costPrice: new Prisma.Decimal('300'),
      unit: '瓶',
      stock: 10,
      alertThreshold: 3,
      image: null,
      description: null,
      isActive: true,
      createdAt: new Date('2026-05-23T10:00:00.000Z'),
      updatedAt: new Date('2026-05-23T10:05:00.000Z'),
    });

    const result = await service.create(user, {
      storeId: 18,
      category: '饮品',
      code: 'SKU-001',
      name: '可乐',
      price: 500,
      profit: 200,
      costPrice: 300,
      unit: '瓶',
      stock: 10,
      alertThreshold: 3,
    });

    expect(
      platformMembershipAccessService.ensureProductQuotaAvailable,
    ).toHaveBeenCalledWith(18);
    expect(prismaService.product.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        storeId: 18,
        categoryId: 7,
        code: 'SKU-001',
        name: '可乐',
      }),
    });
    expect(result.id).toBe('11');
  });
});
