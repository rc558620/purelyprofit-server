import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import { AccessControlService } from '../access-control/access-control.service';
import { SubjectCapabilityService } from '../access-control/subject-capability.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { AUTH_TOKEN_VERSION_KEY_PREFIX } from './auth.constants';
import { AuthAccountService } from './auth-account.service';
import { AuthAuthenticationService } from './auth-authentication.service';
import { AuthCapabilityService } from './auth-capability.service';
import { AuthCodeService } from './auth-code.service';
import { AuthPasswordService } from './auth-password.service';
import { AuthProfileService } from './auth-profile.service';
import { AuthService } from './auth.service';
import { AuthSessionService } from './auth-session.service';
import { AuthSmsService } from './auth-sms.service';
import { PlatformMembershipAccessService } from '../member/platform-membership/platform-membership-access.service';

describe('AuthService', () => {
  let service: AuthService;

  const prismaService = {
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    staff: {
      findFirst: jest.fn(),
      updateMany: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    store: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    storeMembershipProfile: {
      findUnique: jest.fn(),
    },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  };
  const jwtService = {
    signAsync: jest.fn(),
  };
  const accessControlService = {
    getEffectivePermissions: jest.fn(),
  };
  const redisService = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  };
  const configService = {
    get: jest.fn(),
  };
  const authSmsService = {
    sendPasswordResetCode: jest.fn(),
    sendRegisterCode: jest.fn(),
  };
  const platformMembershipAccessService = {
    getSubAccountQuota: jest.fn().mockResolvedValue(0),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    configService.get.mockImplementation((key: string) => {
      const configMap: Record<string, unknown> = {
        'auth.passwordResetCodeTtlSeconds': 600,
        'auth.registerCodeTtlSeconds': 600,
        nodeEnv: 'development',
      };

      return configMap[key];
    });
    prismaService.$transaction.mockImplementation(
      (callback: (tx: typeof prismaService) => unknown) =>
        callback(prismaService),
    );
    prismaService.$queryRaw.mockResolvedValue([]);
    prismaService.user.create.mockResolvedValue({
      id: 1,
      email: 'phone_13800138000@purelyprofit.local',
    });
    prismaService.staff.updateMany.mockResolvedValue({ count: 0 });
    prismaService.staff.findMany.mockResolvedValue([]);
    prismaService.store.findMany.mockResolvedValue([]);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        AuthAccountService,
        AuthAuthenticationService,
        AuthCodeService,
        AuthPasswordService,
        AuthProfileService,
        AuthSessionService,
        AuthCapabilityService,
        SubjectCapabilityService,
        { provide: PrismaService, useValue: prismaService },
        { provide: JwtService, useValue: jwtService },
        { provide: AccessControlService, useValue: accessControlService },
        { provide: RedisService, useValue: redisService },
        { provide: ConfigService, useValue: configService },
        { provide: AuthSmsService, useValue: authSmsService },
        {
          provide: PlatformMembershipAccessService,
          useValue: platformMembershipAccessService,
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('仅允许 admin 别名映射到固定手机号登录', async () => {
    const hashedPassword = await bcrypt.hash('admin123', 4);
    prismaService.staff.findFirst.mockResolvedValue({
      user: {
        id: 1,
        email: 'phone_13800000000@purelyprofit.local',
        password: hashedPassword,
      },
    });
    redisService.get.mockResolvedValue('0');
    jwtService.signAsync.mockResolvedValue('admin-token');

    const result = await service.login({
      account: 'admin',
      password: 'admin123',
    });

    expect(prismaService.staff.findFirst).toHaveBeenCalledWith({
      where: {
        phone: '13619654020',
        isActive: true,
        userId: { not: null },
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      select: {
        user: {
          select: {
            id: true,
            email: true,
            password: true,
          },
        },
      },
    });
    expect(result).toEqual({ access_token: 'admin-token' });
    expect(jwtService.signAsync).toHaveBeenCalledWith({
      sub: 1,
      phone: '13619654020',
      sessionVersion: 0,
    });
  });

  it('支持通过子账号别名登录', async () => {
    const hashedPassword = await bcrypt.hash('111111', 4);
    prismaService.staff.findFirst.mockResolvedValue({
      phone: '13145645646',
      user: {
        id: 59,
        email: 'phone_13145645646@purelyprofit.local',
        password: hashedPassword,
      },
    });
    redisService.get.mockResolvedValue('0');
    jwtService.signAsync.mockResolvedValue('sub-account-token');

    const result = await service.login({
      account: 'aaaaaa3',
      password: '111111',
    });

    expect(prismaService.staff.findFirst).toHaveBeenCalledWith({
      where: {
        email: 'account_aaaaaa3@purelyprofit.local',
        isActive: true,
        userId: { not: null },
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      select: {
        phone: true,
        user: {
          select: {
            id: true,
            email: true,
            password: true,
          },
        },
      },
    });
    expect(result).toEqual({ access_token: 'sub-account-token' });
    expect(jwtService.signAsync).toHaveBeenCalledWith({
      sub: 59,
      phone: '13145645646',
      sessionVersion: 0,
    });
  });

  it('Pulse 已封禁账号不允许重新登录', async () => {
    const hashedPassword = await bcrypt.hash('blocked123', 4);
    prismaService.staff.findFirst.mockResolvedValue({
      user: {
        id: 18,
        email: 'phone_13800138000@purelyprofit.local',
        password: hashedPassword,
      },
    });
    prismaService.store.findMany.mockResolvedValue([{ id: 18 }]);
    redisService.get.mockResolvedValue('违规操作');

    await expect(
      service.login({
        phone: '13800138000',
        password: 'blocked123',
      }),
    ).rejects.toThrow('账号已被封禁');

    expect(jwtService.signAsync).not.toHaveBeenCalled();
  });

  it('修改密码后会刷新 token 并使旧 token 失效', async () => {
    const hashedPassword = await bcrypt.hash('oldPassword123', 4);
    prismaService.user.findUnique.mockResolvedValue({
      id: 1,
      email: 'user@example.com',
      password: hashedPassword,
    });
    prismaService.user.update.mockResolvedValue(undefined);
    redisService.get.mockResolvedValueOnce('0').mockResolvedValueOnce('1');
    redisService.set.mockResolvedValue(undefined);
    jwtService.signAsync.mockResolvedValue('next-token');

    const result = await service.changePassword(
      {
        id: 1,
        email: 'user@example.com',
        phone: '13800138000',
        name: '测试用户',
        createdAt: new Date(),
        updatedAt: new Date(),
        currentMembership: null,
      },
      {
        currentPassword: 'oldPassword123',
        newPassword: 'newPassword123',
      },
    );

    expect(result).toEqual({
      message: '密码修改成功，旧登录态已失效',
      access_token: 'next-token',
    });
    expect(redisService.set).toHaveBeenCalledWith(
      `${AUTH_TOKEN_VERSION_KEY_PREFIX}1`,
      '1',
    );
    expect(jwtService.signAsync).toHaveBeenCalledWith({
      sub: 1,
      phone: '13800138000',
      sessionVersion: 1,
    });
  });

  it('找回密码会缓存验证码并尝试发送短信', async () => {
    prismaService.staff.findFirst.mockResolvedValue({
      user: {
        id: 1,
        email: 'phone_13800138000@purelyprofit.local',
        password: 'hashed',
      },
    });
    redisService.set.mockResolvedValue(undefined);
    authSmsService.sendPasswordResetCode.mockResolvedValue(undefined);

    const result = await service.forgotPassword({
      phone: '13800138000',
    });

    expect(result.message).toBe(
      '如手机号已注册，重置验证码短信已发送，请注意查收',
    );
    expect(result.expiresInSeconds).toBe(600);
    expect(result.resetCode).toMatch(/^\d{6}$/);
    expect(redisService.set).toHaveBeenCalledWith(
      'auth:password-reset:13800138000',
      result.resetCode,
      600,
    );
    expect(authSmsService.sendPasswordResetCode).toHaveBeenCalledWith({
      phone: '13800138000',
      code: result.resetCode,
      expiresInSeconds: 600,
    });
  });

  it('短信发送失败时会删除验证码并抛出异常', async () => {
    const sendError = new Error('验证码短信发送失败，请稍后重试');
    prismaService.staff.findFirst.mockResolvedValue({
      user: {
        id: 1,
        email: 'phone_13800138000@purelyprofit.local',
        password: 'hashed',
      },
    });
    redisService.set.mockResolvedValue(undefined);
    redisService.del.mockResolvedValue(undefined);
    authSmsService.sendPasswordResetCode.mockRejectedValue(sendError);

    await expect(service.forgotPassword({ phone: '13800138000' })).rejects.toBe(
      sendError,
    );
    expect(redisService.del).toHaveBeenCalledWith(
      'auth:password-reset:13800138000',
    );
  });

  it('验证码无效或过期时不允许重置密码', async () => {
    redisService.get.mockResolvedValue(null);

    await expect(
      service.resetPassword({
        phone: '13800138000',
        code: '123456',
        password: 'newPassword123',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('新密码不能与旧密码相同', async () => {
    const hashedPassword = await bcrypt.hash('samePassword123', 4);
    redisService.get.mockResolvedValue('123456');
    prismaService.staff.findFirst.mockResolvedValue({
      user: {
        id: 1,
        email: 'phone_13800138000@purelyprofit.local',
        password: hashedPassword,
      },
    });

    await expect(
      service.resetPassword({
        phone: '13800138000',
        code: '123456',
        password: 'samePassword123',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prismaService.user.update).not.toHaveBeenCalled();
  });

  it('获取 profile 时返回真实头像与实名认证信息', async () => {
    prismaService.user.findUnique.mockResolvedValueOnce({
      id: 1,
      email: 'phone_13800138000@purelyprofit.local',
      name: '测试用户',
      avatar: 'data:image/png;base64,abc',
      realName: '张三',
      idNumber: '110101199001011234',
      createdAt: new Date('2026-05-12T10:00:00.000Z'),
      updatedAt: new Date('2026-05-13T10:00:00.000Z'),
    });
    prismaService.$queryRaw = jest.fn().mockResolvedValue([]);

    const result = await service.getProfile({
      id: 1,
      email: 'phone_13800138000@purelyprofit.local',
      phone: '13800138000',
      name: '测试用户',
      createdAt: new Date('2026-05-12T10:00:00.000Z'),
      updatedAt: new Date('2026-05-13T10:00:00.000Z'),
      currentMembership: null,
    });

    expect(result.user.avatar).toBe('data:image/png;base64,abc');
    expect(result.user.verified).toBe(true);
    expect(result.user.realName).toBe('张三');
    expect(result.user.idNumberMasked).toBe('110101********1234');
    expect(result.currentMembership).toBeNull();
    expect(result.store).toBeNull();
  });

  it('获取 profile 时返回子账号角色标识给前端', async () => {
    prismaService.user.findUnique.mockResolvedValueOnce({
      id: 59,
      email: 'phone_13145645646@purelyprofit.local',
      name: '房东莎莎的',
      avatar: null,
      realName: null,
      idNumber: null,
      createdAt: new Date('2026-05-12T10:00:00.000Z'),
      updatedAt: new Date('2026-05-13T10:00:00.000Z'),
    });
    prismaService.$queryRaw = jest.fn().mockResolvedValueOnce([
      {
        storeName: '会发光',
        address: '深圳南山',
        storeCreatedAt: new Date('2026-05-12T10:00:00.000Z'),
        storeUpdatedAt: new Date('2026-05-13T10:00:00.000Z'),
      },
    ]);

    const result = await service.getProfile({
      id: 59,
      email: 'phone_13145645646@purelyprofit.local',
      phone: '13145645646',
      name: '房东莎莎的',
      createdAt: new Date('2026-05-12T10:00:00.000Z'),
      updatedAt: new Date('2026-05-13T10:00:00.000Z'),
      currentMembership: {
        staffId: 55,
        storeId: 48,
        role: 'STAFF',
        permissions: ['members:view', 'marketing:view'],
        isActive: true,
        subjectType: 'sub_account',
        linkedEmployeeId: 6,
        subAccountId: 3,
        subAccountRole: 'manager',
        subAccountStatus: 'active',
        subAccountAssigned: true,
        canAccessHome: true,
        canUseHandover: true,
      },
    });

    expect(result.currentMembership).toMatchObject({
      identityType: 'sub_account',
      subAccountRole: 'manager',
      subAccountRoleLabel: '店长',
      staffId: 55,
      linkedEmployeeId: 6,
      storeId: 48,
      subAccountId: 3,
      subAccountStatus: 'active',
      subAccountAssigned: true,
      canAccessHome: true,
      canUseHandover: true,
    });
  });

  it('getCapability 返回首页能力快照', async () => {
    platformMembershipAccessService.getSubAccountQuota.mockResolvedValueOnce(2);

    await expect(
      service.getCapability({
        id: 59,
        email: 'phone_13145645646@purelyprofit.local',
        phone: '13145645646',
        name: '房东莎莎的',
        createdAt: new Date('2026-05-12T10:00:00.000Z'),
        updatedAt: new Date('2026-05-13T10:00:00.000Z'),
        currentMembership: {
          staffId: 55,
          storeId: 48,
          role: 'STAFF',
          permissions: ['operation-entry:view', 'operation-entry:create'],
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
      }),
    ).resolves.toMatchObject({
      identityType: 'sub_account',
      subAccountRole: 'cashier',
      subAccountRoleLabel: '收银员',
      subAccountQuota: 2,
      subAccountEnabled: true,
      allowedHomeModules: ['additional', 'space-management', 'handover-management'],
      canUseGoodsManagement: false,
      canUseHandoverManagement: true,
      canUseSpaceManagement: true,
    });
  });

  it('更新头像后返回最新 profile', async () => {
    prismaService.user.update.mockResolvedValue(undefined);
    prismaService.user.findUnique.mockResolvedValueOnce({
      id: 1,
      email: 'phone_13800138000@purelyprofit.local',
      name: '测试用户',
      avatar: 'data:image/png;base64,next',
      realName: null,
      idNumber: null,
      createdAt: new Date('2026-05-12T10:00:00.000Z'),
      updatedAt: new Date('2026-05-13T10:00:00.000Z'),
    });
    prismaService.$queryRaw = jest.fn().mockResolvedValue([]);

    const result = await service.updateAvatar(
      {
        id: 1,
        email: 'phone_13800138000@purelyprofit.local',
        phone: '13800138000',
        name: '测试用户',
        createdAt: new Date('2026-05-12T10:00:00.000Z'),
        updatedAt: new Date('2026-05-13T10:00:00.000Z'),
        currentMembership: null,
      },
      {
        avatar: 'data:image/png;base64,next',
      },
    );

    expect(prismaService.user.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { avatar: 'data:image/png;base64,next' },
    });
    expect(result.user.avatar).toBe('data:image/png;base64,next');
    expect(result.user.verified).toBe(false);
  });

  it('实名认证时同一个身份证号不能绑定多个账号', async () => {
    prismaService.user.findFirst.mockResolvedValue({ id: 2 });

    await expect(
      service.verifyRealName(
        {
          id: 1,
          email: 'phone_13800138000@purelyprofit.local',
          phone: '13800138000',
          name: '测试用户',
          createdAt: new Date('2026-05-12T10:00:00.000Z'),
          updatedAt: new Date('2026-05-13T10:00:00.000Z'),
          currentMembership: null,
        },
        {
          realName: '张三',
          idNumber: '110101199001011234',
        },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
