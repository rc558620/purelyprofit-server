import { Test, TestingModule } from '@nestjs/testing';
import { AccessControlService } from '../access-control/access-control.service';
import { SubjectCapabilityService } from '../access-control/subject-capability.service';
import { PlatformMembershipAccessService } from '../member/platform-membership/platform-membership-access.service';
import { StoreBusinessCapabilityService } from '../stores/store-business-capability.service';
import type { StoreBusinessCapability } from '../stores/store-business-capability.service';
import { AuthCapabilityService } from './auth-capability.service';
import type { AuthenticatedUser } from './strategies/jwt.strategy';

describe('AuthCapabilityService', () => {
  let service: AuthCapabilityService;

  const platformMembershipAccessService = {
    getSubAccountQuota: jest.fn(),
  };

  const subjectCapabilityService = {
    buildSnapshot: jest.fn(),
  };

  const storeBusinessCapabilityService = {
    getCapabilities: jest.fn(),
  };

  const accessControlService = new AccessControlService();

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
      role: 'staff',
      permissions: ['operation-entry:view'],
      isActive: true,
      subjectType: 'sub_account',
      linkedEmployeeId: 6,
      subAccountId: 3,
      subAccountRole: 'cashier',
      subAccountStatus: 'active',
      subAccountAssigned: true,
      canAccessHome: true,
      canUseHandover: true,
    },
  };

  const generalStoreCapabilities: StoreBusinessCapability = {
    businessMode: 'general',
    isCateringStore: false,
    isGeneralStore: true,
    canUseScanOrdering: false,
    canManageScanOrderingMenu: false,
    canUseSpaceManagement: true,
    canUseMarketingProductListing: true,
  };

  const cateringStoreCapabilities: StoreBusinessCapability = {
    businessMode: 'catering',
    isCateringStore: true,
    isGeneralStore: false,
    canUseScanOrdering: true,
    canManageScanOrderingMenu: true,
    canUseSpaceManagement: false,
    canUseMarketingProductListing: false,
  };

  const safeDefaultCapabilities: StoreBusinessCapability = {
    businessMode: 'general',
    isCateringStore: false,
    isGeneralStore: false,
    canUseScanOrdering: false,
    canManageScanOrderingMenu: false,
    canUseSpaceManagement: false,
    canUseMarketingProductListing: false,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    platformMembershipAccessService.getSubAccountQuota.mockResolvedValue(3);
    subjectCapabilityService.buildSnapshot.mockReturnValue({
      identityType: 'sub_account',
      subAccountRole: 'cashier',
      subAccountQuota: 3,
      subAccountEnabled: true,
      allowedHomeModules: ['additional', 'space-management'],
      hiddenHomeModules: ['finance-center'],
      canViewFinance: false,
      canViewMarketing: false,
      canUseGoodsManagement: false,
      canUseHandoverManagement: true,
      canUseSpaceManagement: true,
      canAccessStoreSettings: false,
    });
    storeBusinessCapabilityService.getCapabilities.mockResolvedValue(
      generalStoreCapabilities,
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthCapabilityService,
        {
          provide: PlatformMembershipAccessService,
          useValue: platformMembershipAccessService,
        },
        {
          provide: SubjectCapabilityService,
          useValue: subjectCapabilityService,
        },
        {
          provide: StoreBusinessCapabilityService,
          useValue: storeBusinessCapabilityService,
        },
        {
          provide: AccessControlService,
          useValue: accessControlService,
        },
      ],
    }).compile();

    service = module.get<AuthCapabilityService>(AuthCapabilityService);
  });

  it('非餐饮门店返回正确的业态能力快照', async () => {
    const result = await service.getCapability(user);

    expect(result.businessMode).toBe('general');
    expect(result.isCateringStore).toBe(false);
    expect(result.isGeneralStore).toBe(true);
    expect(result.canUseScanOrdering).toBe(false);
    expect(result.canManageScanOrderingMenu).toBe(false);
    expect(result.canUseSpaceManagement).toBe(true);
    expect(result.canUseMarketingProductListing).toBe(false);
    expect(storeBusinessCapabilityService.getCapabilities).toHaveBeenCalledWith(
      user,
    );
  });

  it('餐饮门店返回正确的业态能力快照', async () => {
    storeBusinessCapabilityService.getCapabilities.mockResolvedValue(
      cateringStoreCapabilities,
    );

    const result = await service.getCapability(user);

    expect(result.businessMode).toBe('catering');
    expect(result.isCateringStore).toBe(true);
    expect(result.isGeneralStore).toBe(false);
    expect(result.canUseSpaceManagement).toBe(false);
    expect(result.canUseMarketingProductListing).toBe(false);
  });

  it('数据库失败时所有业态受限能力均为 false', async () => {
    storeBusinessCapabilityService.getCapabilities.mockResolvedValue(
      safeDefaultCapabilities,
    );

    const result = await service.getCapability(user);

    expect(result.isCateringStore).toBe(false);
    expect(result.isGeneralStore).toBe(false);
    expect(result.canUseScanOrdering).toBe(false);
    expect(result.canUseSpaceManagement).toBe(false);
    expect(result.canUseMarketingProductListing).toBe(false);
  });

  it('无 currentMembership 时返回安全默认值', async () => {
    subjectCapabilityService.buildSnapshot.mockReturnValue({
      identityType: 'staff',
      subAccountRole: null,
      subAccountQuota: 0,
      subAccountEnabled: false,
      allowedHomeModules: [],
      hiddenHomeModules: ['additional'],
      canViewFinance: false,
      canViewMarketing: false,
      canUseGoodsManagement: false,
      canUseHandoverManagement: false,
      canUseSpaceManagement: false,
      canAccessStoreSettings: false,
    });
    storeBusinessCapabilityService.getCapabilities.mockResolvedValue(
      safeDefaultCapabilities,
    );

    const result = await service.getCapability({
      ...user,
      currentMembership: null,
    });

    expect(result.canUseScanOrdering).toBe(false);
    expect(result.canUseSpaceManagement).toBe(false);
    expect(result.canUseMarketingProductListing).toBe(false);
    expect(
      platformMembershipAccessService.getSubAccountQuota,
    ).not.toHaveBeenCalled();
  });

  it('不直接查询 Prisma.store，而是通过 StoreBusinessCapabilityService 获取', async () => {
    await service.getCapability(user);

    expect(
      storeBusinessCapabilityService.getCapabilities,
    ).toHaveBeenCalledTimes(1);
    expect(storeBusinessCapabilityService.getCapabilities).toHaveBeenCalledWith(
      user,
    );
  });

  it('会员降级后 getSubAccountQuota 返回 0 时 subAccountEnabled 应为 false', async () => {
    platformMembershipAccessService.getSubAccountQuota.mockResolvedValue(0);
    subjectCapabilityService.buildSnapshot.mockReturnValue({
      identityType: 'sub_account',
      subAccountRole: 'cashier',
      subAccountQuota: 0,
      subAccountEnabled: false,
      allowedHomeModules: ['additional', 'space-management'],
      hiddenHomeModules: ['finance-center'],
      canViewFinance: false,
      canViewMarketing: false,
      canUseGoodsManagement: false,
      canUseHandoverManagement: true,
      canUseSpaceManagement: true,
      canAccessStoreSettings: false,
    });

    const result = await service.getCapability(user);

    expect(result.subAccountEnabled).toBe(false);
    expect(result.subAccountQuota).toBe(0);
    expect(subjectCapabilityService.buildSnapshot).toHaveBeenCalledWith(
      user.currentMembership,
      0,
    );
  });
});
