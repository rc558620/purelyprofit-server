import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { SalesRecordProductsService } from './sales-record-products.service';

describe('SalesRecordProductsService', () => {
  let service: SalesRecordProductsService;

  const prismaService = {
    product: {
      findMany: jest.fn(),
    },
  };

  const commerceAccessService = {
    resolveViewStoreId: jest.fn(),
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalesRecordProductsService,
        { provide: PrismaService, useValue: prismaService },
        { provide: CommerceAccessService, useValue: commerceAccessService },
      ],
    }).compile();

    service = module.get<SalesRecordProductsService>(
      SalesRecordProductsService,
    );
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
    expect(commerceAccessService.resolveViewStoreId).toHaveBeenCalledWith(
      user,
      18,
      'operation-entry:view',
      '无权查看该门店开始营业商品',
    );
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

  it('listProducts 在无可访问门店时返回空数组', async () => {
    commerceAccessService.resolveViewStoreId.mockResolvedValue(null);

    await expect(service.listProducts(user, { storeId: 18 })).resolves.toEqual(
      [],
    );
    expect(prismaService.product.findMany).not.toHaveBeenCalled();
  });
});
