import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../../redis/invalidator';
import { SuppliersProfileService } from './suppliers-profile.service';
import { SuppliersReadService } from './suppliers-read.service';
import { SuppliersService } from './suppliers.service';
import { SuppliersWriteService } from './suppliers-write.service';

describe('SuppliersService', () => {
  let service: SuppliersService;

  const prismaService = {
    supplier: {
      findMany: jest.fn(),
      count: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    purchaseOrder: {
      count: jest.fn(),
    },
  };

  const commerceAccessService = {
    resolveViewStoreId: jest.fn(),
    resolveSingleStoreId: jest.fn(),
    ensureCanAccessStore: jest.fn(),
  };

  const cacheInvalidatorService = {
    invalidateProfitDashboardHome: jest.fn(),
    invalidatePulseDashboardOverview: jest.fn(),
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
    configService.get.mockImplementation((key: string) => {
      if (key === 'app.defaultPageSize') return 20;
      if (key === 'app.maxPageSize') return 100;
      return undefined;
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SuppliersProfileService,
        SuppliersReadService,
        SuppliersWriteService,
        SuppliersService,
        { provide: PrismaService, useValue: prismaService },
        { provide: CommerceAccessService, useValue: commerceAccessService },
        { provide: CacheInvalidatorService, useValue: cacheInvalidatorService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<SuppliersService>(SuppliersService);
  });

  // ── list ──────────────────────────────────────────────────────────────

  describe('list', () => {
    it('在无可见门店时返回空分页', async () => {
      commerceAccessService.resolveViewStoreId.mockResolvedValue(null);

      const result = await service.list(user, { storeId: 18 });
      expect(result.items).toEqual([]);
      expect(result.meta.total).toBe(0);
      expect(prismaService.supplier.findMany).not.toHaveBeenCalled();
    });

    it('会按门店和关键词查询并返回分页结果', async () => {
      const createdAt = new Date('2026-05-14T10:00:00.000Z');
      const updatedAt = new Date('2026-05-14T12:00:00.000Z');

      commerceAccessService.resolveViewStoreId.mockResolvedValue(18);
      prismaService.supplier.count.mockResolvedValue(1);
      prismaService.supplier.findMany.mockResolvedValue([
        {
          id: 11,
          storeId: 18,
          name: '可口可乐供应商',
          contact: '张老板',
          phone: '13800138000',
          category: '饮品',
          note: '每周三送货',
          createdAt,
          updatedAt,
        },
      ]);

      const result = await service.list(user, {
        storeId: 18,
        keyword: '可乐',
      });
      expect(result.items).toEqual([
        {
          id: '11',
          name: '可口可乐供应商',
          contact: '张老板',
          phone: '13800138000',
          category: '饮品',
          note: '每周三送货',
          createdAt: createdAt.getTime(),
          updatedAt: updatedAt.getTime(),
        },
      ]);
      expect(result.meta).toEqual({
        page: 1,
        pageSize: 20,
        total: 1,
        totalPages: 1,
      });

      expect(prismaService.supplier.findMany).toHaveBeenCalledWith({
        where: {
          storeId: 18,
          OR: [
            { name: { contains: '可乐', mode: 'insensitive' } },
            { contact: { contains: '可乐', mode: 'insensitive' } },
            { phone: { startsWith: '可乐' } },
          ],
        },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip: 0,
        take: 20,
      });
    });

    it('无关键字时查询全量并分页', async () => {
      commerceAccessService.resolveViewStoreId.mockResolvedValue(18);
      prismaService.supplier.count.mockResolvedValue(0);
      prismaService.supplier.findMany.mockResolvedValue([]);

      const result = await service.list(user, { storeId: 18 });
      expect(result.items).toEqual([]);
      expect(result.meta.total).toBe(0);

      expect(prismaService.supplier.findMany).toHaveBeenCalledWith({
        where: { storeId: 18 },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip: 0,
        take: 20,
      });
    });
  });

  // ── create ────────────────────────────────────────────────────────────

  describe('create', () => {
    it('正常创建供应商成功', async () => {
      const createdAt = new Date('2026-05-14T10:00:00.000Z');
      const updatedAt = new Date('2026-05-14T10:00:00.000Z');

      commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
      prismaService.supplier.findFirst.mockResolvedValue(null);
      prismaService.supplier.create.mockResolvedValue({
        id: 11,
        storeId: 18,
        name: '可口可乐供应商',
        contact: '张老板',
        phone: null,
        category: null,
        note: null,
        createdAt,
        updatedAt,
      });

      const result = await service.create(user, {
        storeId: 18,
        name: '  可口可乐供应商  ',
        contact: '张老板',
      });

      expect(result).toEqual({
        id: '11',
        name: '可口可乐供应商',
        contact: '张老板',
        createdAt: createdAt.getTime(),
        updatedAt: updatedAt.getTime(),
      });

      // 名称 trim 后校验唯一性
      expect(prismaService.supplier.findFirst).toHaveBeenCalledWith({
        where: {
          storeId: 18,
          name: { equals: '可口可乐供应商', mode: 'insensitive' },
        },
        select: { id: true },
      });

      // 触发缓存失效
      expect(
        cacheInvalidatorService.invalidateProfitDashboardHome,
      ).toHaveBeenCalledWith(18);
      expect(
        cacheInvalidatorService.invalidatePulseDashboardOverview,
      ).toHaveBeenCalledWith(18);
    });

    it('在名称重复时抛出 ConflictException', async () => {
      commerceAccessService.resolveSingleStoreId.mockResolvedValue(18);
      prismaService.supplier.findFirst.mockResolvedValue({ id: 99 });

      await expect(
        service.create(user, {
          storeId: 18,
          name: '  可口可乐供应商  ',
          contact: '张老板',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  // ── update ────────────────────────────────────────────────────────────

  describe('update', () => {
    const createdAt = new Date('2026-05-14T10:00:00.000Z');
    const updatedAt = new Date('2026-05-15T09:00:00.000Z');

    it('会校验权限并支持清空可选字段', async () => {
      prismaService.supplier.findUnique.mockResolvedValue({
        id: 11,
        storeId: 18,
        name: '旧供应商',
        contact: '旧联系人',
        phone: '13800138000',
        category: '饮品',
        note: '旧备注',
        createdAt,
        updatedAt: createdAt,
      });
      prismaService.supplier.findFirst.mockResolvedValue(null);
      prismaService.supplier.update.mockResolvedValue({
        id: 11,
        storeId: 18,
        name: '新供应商',
        contact: null,
        phone: null,
        category: null,
        note: null,
        createdAt,
        updatedAt,
      });

      await expect(
        service.update(user, 11, {
          name: '  新供应商  ',
          contact: '',
          phone: '   ',
          category: '',
          note: '',
        }),
      ).resolves.toEqual({
        id: '11',
        name: '新供应商',
        createdAt: createdAt.getTime(),
        updatedAt: updatedAt.getTime(),
      });

      expect(commerceAccessService.ensureCanAccessStore).toHaveBeenCalledWith(
        user,
        18,
        'supplier:update',
        '无权操作该门店供应商',
      );
      expect(prismaService.supplier.update).toHaveBeenCalledWith({
        where: { id: 11 },
        data: {
          name: '新供应商',
          contact: null,
          phone: null,
          category: null,
          note: null,
        },
      });

      // 触发缓存失效
      expect(
        cacheInvalidatorService.invalidateProfitDashboardHome,
      ).toHaveBeenCalledWith(18);
      expect(
        cacheInvalidatorService.invalidatePulseDashboardOverview,
      ).toHaveBeenCalledWith(18);
    });

    it('在供应商不存在时抛出 NotFoundException', async () => {
      prismaService.supplier.findUnique.mockResolvedValue(null);

      await expect(
        service.update(user, 11, { name: '新供应商' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('更新名称为纯空格时抛出 BadRequestException', async () => {
      prismaService.supplier.findUnique.mockResolvedValue({
        id: 11,
        storeId: 18,
        name: '旧供应商',
        contact: null,
        phone: null,
        category: null,
        note: null,
        createdAt,
        updatedAt: createdAt,
      });

      await expect(
        service.update(user, 11, { name: '   ' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('更新名称与已有供应商重复时抛出 ConflictException', async () => {
      prismaService.supplier.findUnique.mockResolvedValue({
        id: 11,
        storeId: 18,
        name: '旧供应商',
        contact: null,
        phone: null,
        category: null,
        note: null,
        createdAt,
        updatedAt: createdAt,
      });
      prismaService.supplier.findFirst.mockResolvedValue({ id: 99 });

      await expect(
        service.update(user, 11, { name: '已有供应商' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  // ── remove ────────────────────────────────────────────────────────────

  describe('remove', () => {
    it('在供应商不存在时抛出 NotFoundException', async () => {
      prismaService.supplier.findUnique.mockResolvedValue(null);

      await expect(service.remove(user, 11)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('在供应商下存在采购订单时抛出 BadRequestException', async () => {
      prismaService.supplier.findUnique.mockResolvedValue({
        id: 11,
        storeId: 18,
      });
      prismaService.purchaseOrder.count.mockResolvedValue(3);

      await expect(service.remove(user, 11)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(service.remove(user, 11)).rejects.toThrow(
        '该供应商下存在采购订单，无法删除',
      );
    });

    it('正常删除供应商成功', async () => {
      prismaService.supplier.findUnique.mockResolvedValue({
        id: 11,
        storeId: 18,
      });
      prismaService.purchaseOrder.count.mockResolvedValue(0);
      prismaService.supplier.delete.mockResolvedValue({ id: 11 });

      await service.remove(user, 11);

      expect(prismaService.supplier.delete).toHaveBeenCalledWith({
        where: { id: 11 },
      });

      // 触发缓存失效
      expect(
        cacheInvalidatorService.invalidateProfitDashboardHome,
      ).toHaveBeenCalledWith(18);
      expect(
        cacheInvalidatorService.invalidatePulseDashboardOverview,
      ).toHaveBeenCalledWith(18);
    });
  });
});
