import { Test, TestingModule } from '@nestjs/testing';
import { SubjectCapabilityService } from '../access-control/subject-capability.service';
import { PlatformMembershipAccessService } from '../member/platform-membership/platform-membership-access.service';
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
      role: 'STAFF',
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
      canUseHandoverManagement: true,
      canUseSpaceManagement: true,
      canAccessStoreSettings: false,
    });

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
      ],
    }).compile();

    service = module.get<AuthCapabilityService>(AuthCapabilityService);
  });

  it('返回独立 capability 快照', async () => {
    await expect(service.getCapability(user)).resolves.toEqual({
      identityType: 'sub_account',
      subAccountRole: 'cashier',
      subAccountRoleLabel: '收银员',
      subAccountStatus: 'active',
      subAccountAssigned: true,
      canAccessHome: true,
      canUseHandover: true,
      subAccountQuota: 3,
      subAccountEnabled: true,
      allowedHomeModules: ['additional', 'space-management'],
      hiddenHomeModules: ['finance-center'],
      canViewFinance: false,
      canViewMarketing: false,
      canUseHandoverManagement: true,
      canUseSpaceManagement: true,
      canAccessStoreSettings: false,
    });
    expect(
      platformMembershipAccessService.getSubAccountQuota,
    ).toHaveBeenCalledWith(18);
    expect(subjectCapabilityService.buildSnapshot).toHaveBeenCalledWith(
      user.currentMembership,
      3,
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

  it('无 currentMembership 时返回空 capability 快照', async () => {
    subjectCapabilityService.buildSnapshot.mockReturnValue({
      identityType: 'staff',
      subAccountRole: null,
      subAccountQuota: 0,
      subAccountEnabled: false,
      allowedHomeModules: [],
      hiddenHomeModules: ['additional'],
      canViewFinance: false,
      canViewMarketing: false,
      canUseHandoverManagement: false,
      canUseSpaceManagement: false,
      canAccessStoreSettings: false,
    });

    await expect(
      service.getCapability({ ...user, currentMembership: null }),
    ).resolves.toMatchObject({
      identityType: 'staff',
      subAccountQuota: 0,
      subAccountEnabled: false,
      allowedHomeModules: [],
    });
    expect(
      platformMembershipAccessService.getSubAccountQuota,
    ).not.toHaveBeenCalled();
  });
});
