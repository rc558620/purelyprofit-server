import { Test, TestingModule } from '@nestjs/testing';
import { CacheInvalidatorService } from '../../redis/invalidator';
import { AccessControlService } from '../access-control/access-control.service';
import { AuthAccountService } from './auth-account.service';
import { AuthProfileService } from './auth-profile.service';
import type { AuthenticatedUser } from './strategies/jwt.strategy';

describe('AuthProfileService', () => {
  let service: AuthProfileService;

  const authAccountService = {
    findProfileUserOrThrow: jest.fn(),
    findCurrentMembership: jest.fn(),
    readStoreProfileMetadata: jest.fn(),
    updateAvatar: jest.fn(),
    verifyRealName: jest.fn(),
  };

  const accessControlService = {
    getEffectivePermissions: jest.fn(),
  };

  const cacheInvalidatorService = {
    invalidatePulseOnboardingStatusByUser: jest.fn(),
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
      permissions: ['marketing:view'],
      isActive: true,
      subjectType: 'sub_account',
      linkedEmployeeId: 12,
      subAccountId: 3,
      subAccountRole: 'manager',
      subAccountStatus: 'active',
      subAccountAssigned: true,
      canAccessHome: true,
      canUseHandover: false,
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    authAccountService.findProfileUserOrThrow.mockResolvedValue({
      id: 1,
      email: 'boss@example.com',
      name: '老板',
      avatar: null,
      realName: '张三',
      idNumber: '110101199001011234',
      createdAt: new Date('2026-05-12T00:00:00.000Z'),
      updatedAt: new Date('2026-05-13T00:00:00.000Z'),
    });
    authAccountService.findCurrentMembership.mockResolvedValue({
      staffId: 8,
      storeId: 18,
      role: 'STAFF',
      permissions: ['marketing:view'],
      isActive: true,
      identityType: 'sub_account',
      subAccountRole: 'manager',
      storeName: '纯利宝测试门店',
      address: '北京市朝阳区望京街道 1 号',
      storeCreatedAt: new Date('2026-05-01T00:00:00.000Z'),
      storeUpdatedAt: new Date('2026-05-10T00:00:00.000Z'),
    });
    authAccountService.readStoreProfileMetadata.mockResolvedValue({
      storeType: '零售',
      region: ['北京市', '北京市', '朝阳区'],
      storeLogo: 'https://img.test/store.png',
    });
    accessControlService.getEffectivePermissions.mockReturnValue([
      'staff:view',
    ]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthProfileService,
        { provide: AuthAccountService, useValue: authAccountService },
        { provide: AccessControlService, useValue: accessControlService },
        {
          provide: CacheInvalidatorService,
          useValue: cacheInvalidatorService,
        },
      ],
    }).compile();

    service = module.get<AuthProfileService>(AuthProfileService);
  });

  it('返回完整的子账号 profile 契约字段', async () => {
    await expect(service.getProfile(user)).resolves.toEqual({
      user: {
        id: 1,
        phone: '13800138000',
        email: 'boss@example.com',
        name: '老板',
        avatar: '',
        verified: true,
        realName: '张三',
        idNumberMasked: '110101********1234',
        createdAt: new Date('2026-05-12T00:00:00.000Z'),
        updatedAt: new Date('2026-05-13T00:00:00.000Z'),
      },
      store: {
        id: 18,
        storeName: '纯利宝测试门店',
        storeType: '零售',
        region: ['北京市', '北京市', '朝阳区'],
        address: '北京市朝阳区望京街道 1 号',
        storeLogo: 'https://img.test/store.png',
        createdAt: new Date('2026-05-01T00:00:00.000Z'),
        updatedAt: new Date('2026-05-10T00:00:00.000Z'),
      },
      currentMembership: {
        identityType: 'sub_account',
        subAccountRole: 'manager',
        subAccountRoleLabel: '店长',
        staffId: 8,
        linkedEmployeeId: 12,
        storeId: 18,
        role: 'STAFF',
        permissions: ['marketing:view'],
        isActive: true,
        subAccountId: 3,
        subAccountStatus: 'active',
        subAccountAssigned: true,
        canAccessHome: true,
        canUseHandover: false,
      },
    });
    expect(authAccountService.findProfileUserOrThrow).toHaveBeenCalledWith(1);
    expect(authAccountService.findCurrentMembership).toHaveBeenCalledWith(user);
    expect(authAccountService.readStoreProfileMetadata).toHaveBeenCalledWith(
      18,
    );
    expect(accessControlService.getEffectivePermissions).not.toHaveBeenCalled();
  });

  it('实名认证后会失效 Pulse onboarding 状态缓存', async () => {
    await service.verifyRealName(user, '李老板', '440301199001011234');

    expect(authAccountService.verifyRealName).toHaveBeenCalledWith(
      1,
      '李老板',
      '440301199001011234',
    );
    expect(
      cacheInvalidatorService.invalidatePulseOnboardingStatusByUser,
    ).toHaveBeenCalledWith(1);
  });

  it('active membership 不匹配时回退到权限计算，但不返回子账号运行态字段', async () => {
    const staleUser: AuthenticatedUser = {
      ...user,
      currentMembership: user.currentMembership
        ? {
            ...user.currentMembership,
            staffId: 99,
          }
        : null,
    };

    await expect(service.getProfile(staleUser)).resolves.toMatchObject({
      currentMembership: {
        identityType: 'sub_account',
        subAccountRole: 'manager',
        staffId: 8,
        storeId: 18,
        role: 'STAFF',
        permissions: ['staff:view'],
        isActive: true,
      },
    });
    expect(accessControlService.getEffectivePermissions).toHaveBeenCalledWith({
      role: 'STAFF',
      permissions: ['marketing:view'],
    });
  });
});
