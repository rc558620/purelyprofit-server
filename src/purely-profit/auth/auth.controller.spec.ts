import { Test, TestingModule } from '@nestjs/testing';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import type { AuthenticatedUser } from './strategies/jwt.strategy';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthRsaService } from './auth-rsa.service';
import { CaptchaTokenService } from './captcha-token.service';
import { AuthSessionService } from './auth-session.service';

const ALLOW_GUARD = { canActivate: jest.fn(() => true) };

describe('AuthController', () => {
  let controller: AuthController;

  const authService = {
    sendRegisterCode: jest.fn(),
    register: jest.fn(),
    login: jest.fn(),
    changePassword: jest.fn(),
    forgotPassword: jest.fn(),
    resetPassword: jest.fn(),
    getProfile: jest.fn(),
    getCapability: jest.fn(),
    updateAvatar: jest.fn(),
    verifyRealName: jest.fn(),
    createStore: jest.fn(),
  };

  const authRsaService = {
    getPublicKeyPem: jest.fn(),
  };

  const captchaTokenService = {
    register: jest.fn(),
    validateAndConsume: jest.fn(),
  };

  const authSessionService = {
    signToken: jest.fn(),
    refreshAccessToken: jest.fn(),
    bumpTokenVersion: jest.fn(),
    getTokenVersion: jest.fn(),
    invalidateAllRefreshTokens: jest.fn(),
  };

  const user: AuthenticatedUser = {
    id: 1,
    email: 'boss@example.com',
    phone: '13800138000',
    name: '老板',
    createdAt: new Date('2026-05-12T00:00:00.000Z'),
    updatedAt: new Date('2026-05-13T00:00:00.000Z'),
    lastActiveAt: null,
    accountScope: 'purely_profit',
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
      canUseHandover: false,
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleBuilder = Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: AuthRsaService, useValue: authRsaService },
        { provide: CaptchaTokenService, useValue: captchaTokenService },
        { provide: AuthSessionService, useValue: authSessionService },
      ],
    });
    moduleBuilder.overrideGuard(JwtAuthGuard).useValue(ALLOW_GUARD);
    const module: TestingModule = await moduleBuilder.compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('capability 透传当前用户', async () => {
    const response = {
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
      hiddenHomeModules: ['business-analysis', 'store-settings'],
      canViewFinance: false,
      canViewMarketing: false,
      canUseGoodsManagement: false,
      canUseHandoverManagement: true,
      canUseSpaceManagement: true,
      canAccessStoreSettings: false,
    };
    authService.getCapability.mockResolvedValue(response);

    await expect(controller.capability(user)).resolves.toEqual(response);
    expect(authService.getCapability).toHaveBeenCalledWith(user);
  });

  it('profile 透传当前用户', async () => {
    const response = {
      user: {
        id: 1,
        phone: '13800138000',
        email: 'boss@example.com',
        name: '老板',
        avatar: '',
        verified: false,
        createdAt: new Date('2026-05-12T00:00:00.000Z'),
        updatedAt: new Date('2026-05-13T00:00:00.000Z'),
        lastActiveAt: null,
      },
      store: null,
      currentMembership: {
        identityType: 'sub_account',
        subAccountRole: 'manager',
        subAccountRoleLabel: '店长',
        staffId: 8,
        storeId: 18,
        role: 'staff',
        permissions: ['marketing:view'],
        isActive: true,
        subAccountId: 3,
        subAccountStatus: 'active',
        subAccountAssigned: true,
        canAccessHome: true,
        canUseHandover: false,
      },
    };
    authService.getProfile.mockResolvedValue(response);

    await expect(controller.profile(user)).resolves.toEqual(response);
    expect(authService.getProfile).toHaveBeenCalledWith(user);
  });

  it('profile 与 capability 子账号运行态字段保持一致', async () => {
    const profileResponse = {
      user: {
        id: 1,
        phone: '13800138000',
        email: 'boss@example.com',
        name: '老板',
        avatar: '',
        verified: false,
        createdAt: new Date('2026-05-12T00:00:00.000Z'),
        updatedAt: new Date('2026-05-13T00:00:00.000Z'),
        lastActiveAt: null,
      },
      store: null,
      currentMembership: {
        identityType: 'sub_account',
        subAccountRole: 'cashier',
        subAccountRoleLabel: '收银员',
        staffId: 8,
        storeId: 18,
        role: 'staff',
        permissions: ['operation-entry:view'],
        isActive: true,
        subAccountId: 3,
        subAccountStatus: 'active',
        subAccountAssigned: true,
        canAccessHome: true,
        canUseHandover: true,
      },
    };
    const capabilityResponse = {
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
      hiddenHomeModules: ['business-analysis', 'store-settings'],
      canViewFinance: false,
      canViewMarketing: false,
      canUseGoodsManagement: false,
      canUseHandoverManagement: true,
      canUseSpaceManagement: true,
      canAccessStoreSettings: false,
    };
    authService.getProfile.mockResolvedValue(profileResponse);
    authService.getCapability.mockResolvedValue(capabilityResponse);

    const profile = await controller.profile(user);
    const capability = await controller.capability(user);

    expect(profile.currentMembership).toMatchObject({
      identityType: capability.identityType,
      subAccountRole: capability.subAccountRole,
      subAccountRoleLabel: capability.subAccountRoleLabel,
      subAccountStatus: capability.subAccountStatus,
      subAccountAssigned: capability.subAccountAssigned,
      canAccessHome: capability.canAccessHome,
      canUseHandover: capability.canUseHandover,
    });
  });
});
