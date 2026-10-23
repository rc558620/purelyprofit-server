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
      linkedEmployeeId: null,
      subAccountId: null,
      subAccountRole: null,
      subAccountStatus: null,
      subAccountAssigned: false,
      canAccessHome: true,
      canUseHandover: false,
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

  describe('getCapabilities - 会员护理档案档位（canUseMemberCare）', () => {
    it('非餐饮门店 + 已开通档位 → 可用', async () => {
      prismaService.store.findUnique.mockResolvedValue({
        businessMode: 'general',
        memberCareEnabled: true,
      });

      const result = await service.getCapabilities(buildUser());

      expect(result.isGeneralStore).toBe(true);
      expect(result.canUseSpaceManagement).toBe(true);
      expect(result.canUseMemberCare).toBe(true);
    });

    it('非餐饮门店 + 未开通档位 → 不可用（零售/服务/便利店/其他）', async () => {
      prismaService.store.findUnique.mockResolvedValue({
        businessMode: 'general',
        memberCareEnabled: false,
      });

      const result = await service.getCapabilities(buildUser());

      expect(result.isGeneralStore).toBe(true);
      expect(result.canUseSpaceManagement).toBe(true);
      expect(result.canUseMemberCare).toBe(false);
    });

    it('餐饮门店即使档位为 true 也不可用（护理档案面向非餐饮场景）', async () => {
      prismaService.store.findUnique.mockResolvedValue({
        businessMode: 'catering',
        memberCareEnabled: true,
      });

      const result = await service.getCapabilities(buildUser());

      expect(result.canUseMemberCare).toBe(false);
    });

    it('登录态 membership 已携带档位时不回源数据库', async () => {
      const result = await service.getCapabilities(
        buildUser({
          currentMembership: {
            staffId: 1,
            storeId: 100,
            role: 'staff',
            permissions: ['*'],
            isActive: true,
            subjectType: 'owner',
            linkedEmployeeId: null,
            subAccountId: null,
            subAccountRole: null,
            subAccountStatus: null,
            subAccountAssigned: false,
            canAccessHome: true,
            canUseHandover: false,
            businessMode: 'general',
            memberCareEnabled: true,
          },
        }),
      );

      expect(result.canUseMemberCare).toBe(true);
      expect(prismaService.store.findUnique).not.toHaveBeenCalled();
    });

    it('门店不存在 / 查询失败时档位不可用（最小权限）', async () => {
      prismaService.store.findUnique.mockResolvedValue(null);
      await expect(service.getCapabilities(buildUser())).resolves.toMatchObject(
        { canUseMemberCare: false },
      );

      prismaService.store.findUnique.mockRejectedValue(new Error('DB down'));
      await expect(service.getCapabilities(buildUser())).resolves.toMatchObject(
        { canUseMemberCare: false },
      );
    });
  });

  describe('ensureMemberCareAccess', () => {
    it('已开通门店不抛异常', async () => {
      prismaService.store.findUnique.mockResolvedValue({
        businessMode: 'general',
        memberCareEnabled: true,
      });

      await expect(
        service.ensureMemberCareAccess(buildUser()),
      ).resolves.not.toThrow();
    });

    it('未开通门店抛 ForbiddenException', async () => {
      prismaService.store.findUnique.mockResolvedValue({
        businessMode: 'general',
        memberCareEnabled: false,
      });

      await expect(service.ensureMemberCareAccess(buildUser())).rejects.toThrow(
        '会员护理档案仅适用于「SPA/养生/美容/」模式的门店',
      );
    });

    it('餐饮门店抛 ForbiddenException', async () => {
      prismaService.store.findUnique.mockResolvedValue({
        businessMode: 'catering',
        memberCareEnabled: true,
      });

      await expect(service.ensureMemberCareAccess(buildUser())).rejects.toThrow(
        '会员护理档案仅适用于「SPA/养生/美容/」模式的门店',
      );
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
            linkedEmployeeId: null,
            subAccountId: null,
            subAccountRole: null,
            subAccountStatus: null,
            subAccountAssigned: false,
            canAccessHome: true,
            canUseHandover: false,
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
