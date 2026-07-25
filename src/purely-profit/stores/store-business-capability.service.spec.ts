import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { StoreBusinessCapabilityService } from './store-business-capability.service';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';

describe('StoreBusinessCapabilityService', () => {
  let service: StoreBusinessCapabilityService;

  const prismaService = {
    store: {
      findUnique: jest.fn(),
    },
  };

  const buildUser = (
    overrides: Partial<AuthenticatedUser> = {},
  ): AuthenticatedUser => ({
    id: 1,
    email: 'boss@example.com',
    phone: '13800138000',
    name: '老板',
    createdAt: new Date('2026-05-12T00:00:00.000Z'),
    updatedAt: new Date('2026-05-13T00:00:00.000Z'),
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

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StoreBusinessCapabilityService,
        { provide: PrismaService, useValue: prismaService },
      ],
    }).compile();
    service = module.get<StoreBusinessCapabilityService>(
      StoreBusinessCapabilityService,
    );
  });

  describe('getCapabilities - 餐饮门店 (catering)', () => {
    it('businessMode = catering 时返回正确的餐饮能力', async () => {
      prismaService.store.findUnique.mockResolvedValue({
        businessMode: 'catering',
      });

      const result = await service.getCapabilities(buildUser());

      expect(result.businessMode).toBe('catering');
      expect(result.isCateringStore).toBe(true);
      expect(result.isGeneralStore).toBe(false);
      expect(result.canUseScanOrdering).toBe(true);
      expect(result.canManageScanOrderingMenu).toBe(true);
      expect(result.canUseSpaceManagement).toBe(false);
      expect(result.canUseMarketingProductListing).toBe(false);
    });

    it('getCapabilitiesByStoreId 也能正确返回餐饮能力', async () => {
      prismaService.store.findUnique.mockResolvedValue({
        businessMode: 'catering',
      });

      const result = await service.getCapabilitiesByStoreId(100);

      expect(result.isCateringStore).toBe(true);
      expect(result.canUseScanOrdering).toBe(true);
      expect(result.canUseSpaceManagement).toBe(false);
    });
  });

  describe('getCapabilities - 非餐饮门店 (general)', () => {
    it('businessMode = general 时返回正确的非餐饮能力', async () => {
      prismaService.store.findUnique.mockResolvedValue({
        businessMode: 'general',
      });

      const result = await service.getCapabilities(buildUser());

      expect(result.businessMode).toBe('general');
      expect(result.isCateringStore).toBe(false);
      expect(result.isGeneralStore).toBe(true);
      expect(result.canUseScanOrdering).toBe(false);
      expect(result.canManageScanOrderingMenu).toBe(false);
      expect(result.canUseSpaceManagement).toBe(true);
      expect(result.canUseMarketingProductListing).toBe(true);
    });
  });

  describe('getCapabilities - 安全默认值', () => {
    it('门店不存在时所有受限能力均为 false', async () => {
      prismaService.store.findUnique.mockResolvedValue(null);

      const result = await service.getCapabilities(buildUser());

      expect(result.businessMode).toBe('general');
      expect(result.isCateringStore).toBe(false);
      expect(result.isGeneralStore).toBe(false);
      expect(result.canUseScanOrdering).toBe(false);
      expect(result.canManageScanOrderingMenu).toBe(false);
      expect(result.canUseSpaceManagement).toBe(false);
      expect(result.canUseMarketingProductListing).toBe(false);
    });

    it('Prisma 查询抛错时所有受限能力均为 false', async () => {
      prismaService.store.findUnique.mockRejectedValue(
        new Error('DB connection failed'),
      );

      const result = await service.getCapabilities(buildUser());

      expect(result.isCateringStore).toBe(false);
      expect(result.isGeneralStore).toBe(false);
      expect(result.canUseScanOrdering).toBe(false);
      expect(result.canUseSpaceManagement).toBe(false);
      expect(result.canUseMarketingProductListing).toBe(false);
    });

    it('user.currentMembership 不存在时所有受限能力均为 false', async () => {
      const result = await service.getCapabilities(
        buildUser({ currentMembership: null }),
      );

      expect(result.isCateringStore).toBe(false);
      expect(result.isGeneralStore).toBe(false);
      expect(result.canUseScanOrdering).toBe(false);
      expect(result.canUseSpaceManagement).toBe(false);
      expect(result.canUseMarketingProductListing).toBe(false);
      expect(prismaService.store.findUnique).not.toHaveBeenCalled();
    });

    it('user.currentMembership.storeId 不存在时返回安全默认值', async () => {
      const result = await service.getCapabilities(
        buildUser({
          currentMembership: {
            staffId: 1,
            storeId: undefined as unknown as number,
            role: 'staff',
            permissions: [],
            isActive: true,
            subjectType: 'staff',
          },
        }),
      );

      expect(result.canUseScanOrdering).toBe(false);
      expect(result.canUseSpaceManagement).toBe(false);
    });
  });

  describe('ensure 方法', () => {
    it('ensureCateringStore - 餐饮门店不抛异常', async () => {
      prismaService.store.findUnique.mockResolvedValue({
        businessMode: 'catering',
      });

      await expect(
        service.ensureCateringStore(buildUser()),
      ).resolves.not.toThrow();
    });

    it('ensureCateringStore - 非餐饮门店抛 ForbiddenException', async () => {
      prismaService.store.findUnique.mockResolvedValue({
        businessMode: 'general',
      });

      await expect(service.ensureCateringStore(buildUser())).rejects.toThrow(
        '该功能仅适用于餐饮门店',
      );
    });

    it('ensureGeneralStore - 非餐饮门店不抛异常', async () => {
      prismaService.store.findUnique.mockResolvedValue({
        businessMode: 'general',
      });

      await expect(
        service.ensureGeneralStore(buildUser()),
      ).resolves.not.toThrow();
    });

    it('ensureGeneralStore - 餐饮门店抛 ForbiddenException', async () => {
      prismaService.store.findUnique.mockResolvedValue({
        businessMode: 'catering',
      });

      await expect(service.ensureGeneralStore(buildUser())).rejects.toThrow(
        '该功能仅适用于非餐饮门店',
      );
    });

    it('ensureScanOrderingAccess - 餐饮门店不抛异常', async () => {
      prismaService.store.findUnique.mockResolvedValue({
        businessMode: 'catering',
      });

      await expect(
        service.ensureScanOrderingAccess(buildUser()),
      ).resolves.not.toThrow();
    });

    it('ensureScanOrderingAccess - 非餐饮门店抛 ForbiddenException', async () => {
      prismaService.store.findUnique.mockResolvedValue({
        businessMode: 'general',
      });

      await expect(
        service.ensureScanOrderingAccess(buildUser()),
      ).rejects.toThrow('扫码点餐功能仅适用于餐饮门店');
    });

    it('ensureSpaceManagementAccess - 非餐饮门店不抛异常', async () => {
      prismaService.store.findUnique.mockResolvedValue({
        businessMode: 'general',
      });

      await expect(
        service.ensureSpaceManagementAccess(buildUser()),
      ).resolves.not.toThrow();
    });

    it('ensureSpaceManagementAccess - 餐饮门店抛 ForbiddenException', async () => {
      prismaService.store.findUnique.mockResolvedValue({
        businessMode: 'catering',
      });

      await expect(
        service.ensureSpaceManagementAccess(buildUser()),
      ).rejects.toThrow('空间管理功能仅适用于非餐饮门店');
    });

    it('ensureMarketingProductListingAccess - 非餐饮门店不抛异常', async () => {
      prismaService.store.findUnique.mockResolvedValue({
        businessMode: 'general',
      });

      await expect(
        service.ensureMarketingProductListingAccess(buildUser()),
      ).resolves.not.toThrow();
    });

    it('ensureMarketingProductListingAccess - 餐饮门店抛 ForbiddenException', async () => {
      prismaService.store.findUnique.mockResolvedValue({
        businessMode: 'catering',
      });

      await expect(
        service.ensureMarketingProductListingAccess(buildUser()),
      ).rejects.toThrow('营销产品上架功能仅适用于非餐饮门店');
    });
  });
});
