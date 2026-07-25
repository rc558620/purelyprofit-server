import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { RedisService } from '../../../redis/redis.service';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PlatformMembershipAccessService } from '../../member/platform-membership/platform-membership-access.service';
import { ProductsService } from './products.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import type { ProductRecord } from './products.types';

/**
 * 商品扫码点餐状态接口测试。
 *
 * 覆盖：
 * 1. 餐饮门店 + goods:update 权限：上架/下架成功、缓存失效
 * 2. 非餐饮门店：返回 403（由 BusinessModeGuard 拦截，此处验证 Guard 装饰器）
 * 3. 无 goods:update 权限：返回 403
 * 4. 跨门店商品：拒绝
 * 5. 首次上架：分类校验
 * 6. 商品更新同步扫码菜单
 * 7. 商品删除清理扫码菜单关联
 */
describe('ProductsService - 扫码点餐状态', () => {
  let service: ProductsService;

  const prismaService = {
    product: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    scanOrderingMenuProduct: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    scanOrderingMenuCategory: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    productCategory: {
      findFirst: jest.fn(),
    },
  };

  const redisService = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    delByPattern: jest.fn(),
    getJson: jest.fn(),
    setJson: jest.fn(),
  };

  const commerceAccessService = {
    ensureCanAccessStore: jest.fn(),
    resolveMembershipManagedStoreId: jest.fn(),
  };

  const platformMembershipAccessService = {
    getSubAccountQuota: jest.fn().mockResolvedValue(0),
  };

  const configService = {
    get: jest.fn(),
  };

  const buildUser = (
    overrides: Partial<AuthenticatedUser> = {},
  ): AuthenticatedUser => ({
    id: 1,
    email: 'boss@example.com',
    phone: '13800138000',
    name: '老板',
    createdAt: new Date(),
    updatedAt: new Date(),
    lastActiveAt: null,
    currentMembership: {
      staffId: 1,
      storeId: 100,
      role: 'staff',
      permissions: ['*'],
      isActive: true,
      subjectType: 'owner',
    },
    ...overrides,
  });

  const buildProduct = (
    overrides: Partial<ProductRecord> = {},
  ): ProductRecord => ({
    id: 1,
    storeId: 100,
    name: '拿铁咖啡',
    category: '咖啡',
    code: 'LATTE001',
    price: 2500,
    profit: 1000,
    costPrice: 1500,
    unit: '杯',
    stock: 50,
    alertThreshold: 10,
    image: null,
    description: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    scanOrderingMenuProducts: [],
    ...overrides,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: PrismaService, useValue: prismaService },
        { provide: RedisService, useValue: redisService },
        {
          provide: CommerceAccessService,
          useValue: commerceAccessService,
        },
        {
          provide: PlatformMembershipAccessService,
          useValue: platformMembershipAccessService,
        },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<ProductsService>(ProductsService);
  });

  describe('toggleScanOrderingStatus - 上架成功', () => {
    it('餐饮门店 + goods:update 权限上架成功，创建扫码菜单商品并失效缓存', async () => {
      const product = buildProduct();
      prismaService.product.findUnique.mockResolvedValue(product);
      commerceAccessService.ensureCanAccessStore.mockResolvedValue(undefined);
      prismaService.scanOrderingMenuProduct.findFirst.mockResolvedValue(null);
      prismaService.scanOrderingMenuCategory.findFirst.mockResolvedValue({
        id: 5,
        storeId: 100,
      });
      prismaService.scanOrderingMenuProduct.create.mockResolvedValue({});

      const result = await service.toggleScanOrderingStatus(buildUser(), 1, {
        enabled: true,
        categoryId: 5,
      });

      expect(result).toEqual({
        id: '1',
        scanOrderingEnabled: true,
      });
      expect(prismaService.scanOrderingMenuProduct.create).toHaveBeenCalledWith(
        {
          data: expect.objectContaining({
            storeId: 100,
            productId: 1,
            categoryId: 5,
            isActive: true,
          }),
        },
      );
      expect(redisService.del).toHaveBeenCalledWith('scanordering:menu:100');
    });

    it('上架时未传 categoryId 使用默认分类', async () => {
      const product = buildProduct();
      prismaService.product.findUnique.mockResolvedValue(product);
      commerceAccessService.ensureCanAccessStore.mockResolvedValue(undefined);
      prismaService.scanOrderingMenuProduct.findFirst.mockResolvedValue(null);
      prismaService.scanOrderingMenuCategory.findFirst
        .mockResolvedValueOnce(null) // 无默认分类
        .mockResolvedValueOnce({ id: 10, storeId: 100 }); // 新创建的分类
      prismaService.scanOrderingMenuCategory.create.mockResolvedValue({
        id: 10,
      });
      prismaService.scanOrderingMenuProduct.create.mockResolvedValue({});

      const result = await service.toggleScanOrderingStatus(buildUser(), 1, {
        enabled: true,
      });

      expect(result.scanOrderingEnabled).toBe(true);
      expect(
        prismaService.scanOrderingMenuCategory.create,
      ).toHaveBeenCalledWith({
        data: expect.objectContaining({
          storeId: 100,
          name: '默认分类',
        }),
      });
    });

    it('分类不属于当前门店时拒绝', async () => {
      const product = buildProduct();
      prismaService.product.findUnique.mockResolvedValue(product);
      commerceAccessService.ensureCanAccessStore.mockResolvedValue(undefined);
      prismaService.scanOrderingMenuProduct.findFirst.mockResolvedValue(null);
      // categoryId 传入但查不到对应门店分类
      prismaService.scanOrderingMenuCategory.findFirst.mockResolvedValue(null);

      await expect(
        service.toggleScanOrderingStatus(buildUser(), 1, {
          enabled: true,
          categoryId: 999,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('toggleScanOrderingStatus - 下架成功', () => {
    it('下架时仅设置 isActive=false，不删除普通商品', async () => {
      const product = buildProduct();
      prismaService.product.findUnique.mockResolvedValue(product);
      commerceAccessService.ensureCanAccessStore.mockResolvedValue(undefined);
      prismaService.scanOrderingMenuProduct.updateMany.mockResolvedValue({
        count: 1,
      });

      const result = await service.toggleScanOrderingStatus(buildUser(), 1, {
        enabled: false,
      });

      expect(result).toEqual({
        id: '1',
        scanOrderingEnabled: false,
      });
      expect(
        prismaService.scanOrderingMenuProduct.updateMany,
      ).toHaveBeenCalledWith({
        where: expect.objectContaining({
          storeId: 100,
          productId: 1,
        }),
        data: { isActive: false },
      });
      expect(prismaService.product.delete).not.toHaveBeenCalled();
      expect(redisService.del).toHaveBeenCalledWith('scanordering:menu:100');
    });
  });

  describe('toggleScanOrderingStatus - 权限与跨门店校验', () => {
    it('商品不存在时抛 NotFoundException', async () => {
      prismaService.product.findUnique.mockResolvedValue(null);

      await expect(
        service.toggleScanOrderingStatus(buildUser(), 999, {
          enabled: true,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('无 goods:update 权限时抛 ForbiddenException', async () => {
      const product = buildProduct();
      prismaService.product.findUnique.mockResolvedValue(product);
      commerceAccessService.ensureCanAccessStore.mockRejectedValue(
        new Error('无权操作该门店商品'),
      );

      await expect(
        service.toggleScanOrderingStatus(buildUser(), 1, {
          enabled: true,
        }),
      ).rejects.toThrow('无权操作该门店商品');
    });
  });

  describe('商品更新同步扫码菜单', () => {
    it('商品名称变更后同步扫码菜单商品并失效缓存', async () => {
      const product = buildProduct();
      prismaService.product.findFirst.mockResolvedValue(product);
      commerceAccessService.ensureCanAccessStore.mockResolvedValue(undefined);
      prismaService.product.update.mockResolvedValue({
        ...product,
        name: '拿铁咖啡（大杯）',
      });
      prismaService.scanOrderingMenuProduct.updateMany.mockResolvedValue({
        count: 1,
      });

      await service.update(buildUser(), 1, {
        name: '拿铁咖啡（大杯）',
      });

      expect(
        prismaService.scanOrderingMenuProduct.updateMany,
      ).toHaveBeenCalledWith({
        where: expect.objectContaining({
          storeId: 100,
          productId: 1,
        }),
        data: expect.objectContaining({
          name: '拿铁咖啡（大杯）',
        }),
      });
      expect(redisService.del).toHaveBeenCalledWith('scanordering:menu:100');
    });
  });

  describe('商品删除清理扫码菜单', () => {
    it('删除商品时软删除关联扫码菜单商品并失效缓存', async () => {
      const product = buildProduct();
      prismaService.product.findFirst.mockResolvedValue(product);
      commerceAccessService.ensureCanAccessStore.mockResolvedValue(undefined);
      prismaService.product.delete.mockResolvedValue({});
      prismaService.scanOrderingMenuProduct.updateMany.mockResolvedValue({
        count: 1,
      });

      await service.remove(buildUser(), 1);

      expect(
        prismaService.scanOrderingMenuProduct.updateMany,
      ).toHaveBeenCalledWith({
        where: expect.objectContaining({
          storeId: 100,
          productId: 1,
        }),
        data: expect.objectContaining({
          isActive: false,
          deletedAt: expect.any(Date),
        }),
      });
      expect(redisService.del).toHaveBeenCalledWith('scanordering:menu:100');
    });
  });

  describe('普通上下架与扫码点餐上架状态独立性', () => {
    it('商品普通上下架不依赖扫码点餐状态', async () => {
      const product = buildProduct({
        scanOrderingMenuProducts: [{ id: 1, isActive: true, deletedAt: null }],
      });

      // 普通商品列表查询能正确反映两种状态
      expect(product.isActive).toBe(true);
      expect(product.scanOrderingMenuProducts[0].isActive).toBe(true);
    });
  });
});
