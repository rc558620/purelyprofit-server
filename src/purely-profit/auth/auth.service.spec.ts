import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { aNonEmptyString } from '../../spec-matchers';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { AccessControlService } from '../access-control/access-control.service';
import { SubjectCapabilityService } from '../access-control/subject-capability.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { CacheInvalidatorService } from '../../redis/invalidator';
import { AUTH_TOKEN_VERSION_KEY_PREFIX } from './auth.constants';
import { AuthAccountLookupService } from './auth-account-lookup.service';
import { AuthProfitAccountLookupService } from './auth-profit-account-lookup.service';
import { AuthBanGuardService } from './auth-ban-guard.service';
import { AuthMembershipResolverService } from './auth-membership-resolver.service';
import { AuthStaffActivationService } from './auth-staff-activation.service';
import { AuthAccountService } from './auth-account.service';
import { AuthAuthenticationService } from './auth-authentication.service';
import { AuthCapabilityService } from './auth-capability.service';
import { AuthCodeService } from './auth-code.service';
import { CaptchaTokenService } from './captcha-token.service';
import { AuthPasswordService } from './auth-password.service';
import { AuthProfileService } from './auth-profile.service';
import { AuthProductAuthService } from '../../shared/auth/auth-product-auth.service';
import { AuthService } from './auth.service';
import { AuthSessionService } from './auth-session.service';
import { AuditLogService } from '../../shared/audit-log.service';
import { AuthSmsService } from './auth-sms.service';
import { AuthRegisterStoreService } from './auth-register-store.service';
import { PlatformMembershipAccessService } from '../member/platform-membership/platform-membership-access.service';
import { StoreInviteCodeService } from '../stores/store-invite-code.service';

describe('AuthService', () => {
  let service: AuthService;
  let authProductAuthService: AuthProductAuthService;
  let authProfileService: AuthProfileService;

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
    setIfAbsent: jest.fn(),
    del: jest.fn(),
    delMany: jest.fn().mockResolvedValue(0),
    incr: jest.fn().mockResolvedValue(1),
    getJson: jest.fn().mockResolvedValue(null),
    setJson: jest.fn().mockResolvedValue(undefined),
    mgetJson: jest.fn().mockResolvedValue([]),
    delByPattern: jest.fn().mockResolvedValue(1),
    zadd: jest.fn().mockResolvedValue(undefined),
    zcard: jest.fn().mockResolvedValue(0),
    zrange: jest.fn().mockResolvedValue([]),
    zremrangebyrank: jest.fn().mockResolvedValue(0),
    zscore: jest.fn().mockResolvedValue(null),
    mget: jest.fn().mockResolvedValue([]),
  };
  const configService = {
    get: jest.fn(),
  };
  const authSmsService = {
    sendPasswordResetCode: jest.fn(),
    sendRegisterCode: jest.fn(),
    sendLoginCode: jest.fn(),
  };
  const platformMembershipAccessService = {
    getSubAccountQuota: jest.fn().mockResolvedValue(0),
  };
  const cacheInvalidatorService = {
    invalidatePulseOnboardingStatusByUser: jest.fn(),
  };
  const storeInviteCodeService = {
    generateForStore: jest.fn().mockResolvedValue('ABCD1234'),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    configService.get.mockImplementation((key: string) => {
      const configMap: Record<string, unknown> = {
        'auth.passwordResetCodeTtlSeconds': 600,
        'auth.registerCodeTtlSeconds': 600,
        'auth.smsSendCooldownSeconds': 60,
        'auth.adminLoginAlias': 'admin',
        'auth.adminLoginPhone': '13619654020',
        'pulse.devAccountEmails': ['dev@example.com'],
        nodeEnv: 'development',
      };

      return configMap[key];
    });
    prismaService.$transaction.mockImplementation(
      (callback: (tx: typeof prismaService) => unknown) =>
        callback(prismaService),
    );
    redisService.setIfAbsent.mockResolvedValue(true);
    prismaService.$queryRaw.mockResolvedValue([]);
    prismaService.user.create.mockResolvedValue({
      id: 1,
      email: 'profit_phone_13800138000@purelyprofit.local',
      accountScope: 'purely_profit',
    });
    prismaService.staff.updateMany.mockResolvedValue({ count: 0 });
    prismaService.staff.findMany.mockResolvedValue([]);
    prismaService.store.findMany.mockResolvedValue([]);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        AuthAccountService,
        AuthAccountLookupService,
        AuthProfitAccountLookupService,
        AuthBanGuardService,
        AuthMembershipResolverService,
        AuthStaffActivationService,
        AuthAuthenticationService,
        AuthCodeService,
        CaptchaTokenService,
        AuthPasswordService,
        AuthProductAuthService,
        AuthProfileService,
        AuthSessionService,
        AuthCapabilityService,
        AuthRegisterStoreService,
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
        {
          provide: CacheInvalidatorService,
          useValue: cacheInvalidatorService,
        },
        {
          provide: StoreInviteCodeService,
          useValue: storeInviteCodeService,
        },
        {
          provide: AuditLogService,
          useValue: { record: jest.fn(), recordAwaitable: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    authProductAuthService = module.get<AuthProductAuthService>(
      AuthProductAuthService,
    );
    authProfileService = module.get<AuthProfileService>(AuthProfileService);
  });

  it('仅允许 admin 别名映射到固定手机号登录', async () => {
    const hashedPassword = await bcrypt.hash('admin123', 4);
    prismaService.staff.findFirst.mockResolvedValue({
      id: 1,
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
        id: true,
        user: {
          select: {
            id: true,
            email: true,
            password: true,
          },
        },
      },
    });
    expect(result).toEqual(
      expect.objectContaining({ access_token: 'admin-token', userId: 1 }),
    );
    expect(jwtService.signAsync).toHaveBeenCalledWith({
      sub: 1,
      phone: '13619654020',
      accountScope: 'developer',
      sessionVersion: 0,
      staffId: 1,
    });
  });

  it('支持通过子账号别名登录', async () => {
    const hashedPassword = await bcrypt.hash('111111', 4);
    prismaService.staff.findMany.mockResolvedValue([
      {
        id: 59,
        userId: 59,
        phone: '13145645646',
        user: {
          id: 59,
          email: 'phone_13145645646@purelyprofit.local',
          password: hashedPassword,
        },
      },
    ]);
    redisService.get.mockResolvedValue('0');
    jwtService.signAsync.mockResolvedValue('sub-account-token');

    const result = await service.login({
      account: 'aaaaaa3',
      password: '111111',
    });

    expect(prismaService.staff.findMany).toHaveBeenCalledWith({
      where: {
        loginAccount: 'aaaaaa3',
        isActive: true,
        userId: { not: null },
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        userId: true,
        phone: true,
        user: {
          select: {
            id: true,
            email: true,
            password: true,
          },
        },
      },
      take: 2,
    });
    expect(result).toEqual(
      expect.objectContaining({
        access_token: 'sub-account-token',
        userId: 59,
      }),
    );
    expect(jwtService.signAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: 59,
        phone: '13145645646',
        accountScope: 'purely_profit',
        sessionVersion: 0,
        staffId: 59,
      }),
    );
  });

  it('purely-pulse 登录仅允许开发者账号', async () => {
    const hashedPassword = await bcrypt.hash('dev123456', 4);
    prismaService.staff.findFirst.mockResolvedValue({
      user: {
        id: 66,
        email: 'dev@example.com',
        password: hashedPassword,
      },
    });
    redisService.get.mockResolvedValue('0');
    jwtService.signAsync.mockResolvedValue('pulse-dev-token');

    await expect(
      authProductAuthService.login(
        {
          phone: '13800138000',
          password: 'dev123456',
        },
        {
          productScope: 'purely_profit',
          requireDeveloper: true,
        },
      ),
    ).resolves.toEqual(
      expect.objectContaining({ access_token: 'pulse-dev-token', userId: 66 }),
    );

    expect(jwtService.signAsync).toHaveBeenCalledWith({
      sub: 66,
      phone: '13800138000',
      accountScope: 'developer',
      sessionVersion: 0,
    });
  });

  it('purely-pulse 登录会拒绝普通 purely-profit 账号', async () => {
    const hashedPassword = await bcrypt.hash('profit123', 4);
    prismaService.staff.findFirst.mockResolvedValue({
      user: {
        id: 67,
        email: 'profit_phone_13800138000@purelyprofit.local',
        password: hashedPassword,
      },
    });
    redisService.get.mockResolvedValue('0');

    await expect(
      authProductAuthService.login(
        {
          phone: '13800138000',
          password: 'profit123',
        },
        {
          productScope: 'purely_profit',
          requireDeveloper: true,
        },
      ),
    ).rejects.toThrow('当前账号不可登录 purely-pulse，请使用开发者账号');

    expect(jwtService.signAsync).not.toHaveBeenCalled();
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

  it('部分门店被封禁时仍允许登录', async () => {
    const hashedPassword = await bcrypt.hash('partial123', 4);
    prismaService.staff.findFirst.mockResolvedValue({
      user: {
        id: 19,
        email: 'phone_13900139000@purelyprofit.local',
        password: hashedPassword,
      },
    });
    prismaService.store.findMany.mockResolvedValue([{ id: 18 }, { id: 19 }]);
    // ensureUserNotBanned 使用 mgetJson 批量查询封禁状态
    // 门店 18 被封（返回 reason），门店 19 未被封（返回 null）
    redisService.mgetJson.mockResolvedValue(['违规操作', null]);
    // signToken.getTokenVersion 使用 get 查 token version
    redisService.get.mockResolvedValue('0');
    redisService.set.mockResolvedValue(undefined);
    jwtService.signAsync.mockResolvedValue('partial-ban-token');

    await expect(
      service.login({
        phone: '13900139000',
        password: 'partial123',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        access_token: 'partial-ban-token',
        userId: 19,
      }),
    );
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
        lastActiveAt: null,
        accountScope: 'purely_profit',
        currentMembership: null,
      },
      {
        currentPassword: 'oldPassword123',
        newPassword: 'newPassword123',
        confirmPassword: 'newPassword123',
      },
    );

    expect(result).toEqual({
      message: '密码修改成功，旧登录态已失效',
      access_token: 'next-token',
    });
    expect(redisService.set).toHaveBeenCalledWith(
      `${AUTH_TOKEN_VERSION_KEY_PREFIX}1`,
      '1',
      30 * 24 * 60 * 60,
    );
    expect(jwtService.signAsync).toHaveBeenCalledWith({
      sub: 1,
      phone: '13800138000',
      accountScope: 'purely_profit',
      sessionVersion: 1,
    });
  });

  it('purely-profit 注册验证码发送会写入冷却键并缓存验证码', async () => {
    prismaService.staff.findFirst.mockResolvedValue(null);
    prismaService.user.findFirst.mockResolvedValue(null);
    redisService.set.mockResolvedValue(undefined);
    authSmsService.sendRegisterCode.mockResolvedValue(undefined);

    const result = await service.sendRegisterCode({
      phone: '13800138000',
    });

    expect(result.message).toBe('验证码已发送，请注意查收');
    expect(result.expiresInSeconds).toBe(600);
    expect(result.code).toMatch(/^\d{6}$/);
    expect(redisService.setIfAbsent).toHaveBeenCalledWith(
      'auth:sms-cooldown:register:purely_profit:13800138000',
      '1',
      60,
    );
    expect(redisService.set).toHaveBeenCalledWith(
      'auth:register:purely_profit:13800138000',
      result.code,
      600,
    );
    expect(authSmsService.sendRegisterCode).toHaveBeenCalledWith({
      phone: '13800138000',
      code: result.code,
      expiresInSeconds: 600,
    });
  });

  it('purely-profit 注册验证码发送在冷却期内会拒绝再次发送', async () => {
    prismaService.staff.findFirst.mockResolvedValue(null);
    prismaService.user.findFirst.mockResolvedValue(null);
    redisService.setIfAbsent.mockResolvedValue(false);

    await expect(
      service.sendRegisterCode({ phone: '13800138000' }),
    ).rejects.toThrow('短信发送过于频繁，请 60 秒后再试');
    expect(redisService.set).not.toHaveBeenCalled();
    expect(authSmsService.sendRegisterCode).not.toHaveBeenCalled();
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

    expect(result.message).toBe('重置验证码短信已发送，请注意查收');
    expect(result.expiresInSeconds).toBe(600);
    expect(result.resetCode).toMatch(/^\d{6}$/);
    expect(redisService.setIfAbsent).toHaveBeenCalledWith(
      'auth:sms-cooldown:password-reset:purely_profit:13800138000',
      '1',
      60,
    );
    expect(redisService.set).toHaveBeenCalledWith(
      'auth:password-reset:purely_profit:13800138000',
      result.resetCode,
      600,
    );
    expect(authSmsService.sendPasswordResetCode).toHaveBeenCalledWith({
      phone: '13800138000',
      code: result.resetCode,
      expiresInSeconds: 600,
    });
  });

  it('找回密码在手机号未注册时返回 404', async () => {
    prismaService.staff.findFirst.mockResolvedValue(null);
    prismaService.user.findFirst.mockResolvedValue(null);

    await expect(
      service.forgotPassword({
        phone: '13800138000',
      }),
    ).rejects.toThrow(new NotFoundException('手机号未注册，请先注册'));
    expect(redisService.setIfAbsent).not.toHaveBeenCalled();
    expect(redisService.set).not.toHaveBeenCalled();
    expect(authSmsService.sendPasswordResetCode).not.toHaveBeenCalled();
  });

  it('找回密码短信发送在冷却期内会拒绝再次发送', async () => {
    prismaService.staff.findFirst.mockResolvedValue({
      user: {
        id: 1,
        email: 'phone_13800138000@purelyprofit.local',
        password: 'hashed',
      },
    });
    redisService.setIfAbsent.mockResolvedValue(false);

    await expect(
      service.forgotPassword({ phone: '13800138000' }),
    ).rejects.toThrow('短信发送过于频繁，请 60 秒后再试');
    expect(redisService.set).not.toHaveBeenCalled();
    expect(authSmsService.sendPasswordResetCode).not.toHaveBeenCalled();
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
      'auth:password-reset:purely_profit:13800138000',
    );
  });

  it('purely-club 登录即注册验证码发送会写入冷却键并缓存验证码', async () => {
    redisService.set.mockResolvedValue(undefined);
    // captchaToken 存在于 Redis 中，模拟已注册的令牌
    redisService.get.mockResolvedValueOnce('1');
    authSmsService.sendLoginCode.mockResolvedValue(undefined);

    const result = await authProductAuthService.sendClubLoginOrRegisterCode({
      phone: '13800138000',
      captchaToken: 'puzzle_1719500000000_1',
    });

    expect(result.message).toBe('验证码已发送，请注意查收');
    expect(result.expiresInSeconds).toBe(600);
    expect(result.code).toMatch(/^\d{6}$/);
    expect(redisService.setIfAbsent).toHaveBeenCalledWith(
      'auth:sms-cooldown:login_or_register:purely_club:13800138000',
      '1',
      60,
    );
    expect(redisService.set).toHaveBeenCalledWith(
      'auth:register:purely_club:13800138000',
      result.code,
      600,
    );
    expect(authSmsService.sendLoginCode).toHaveBeenCalledWith({
      phone: '13800138000',
      code: result.code,
      expiresInSeconds: 600,
    });
  });

  it('purely-club 登录即注册验证码发送在冷却期内会拒绝再次发送', async () => {
    redisService.setIfAbsent.mockResolvedValue(false);
    // captchaToken 存在于 Redis 中，模拟已注册的令牌
    redisService.get.mockResolvedValueOnce('1');

    await expect(
      authProductAuthService.sendClubLoginOrRegisterCode({
        phone: '13800138000',
        captchaToken: 'puzzle_1719500000000_2',
      }),
    ).rejects.toThrow('短信发送过于频繁，请 60 秒后再试');
    expect(redisService.set).not.toHaveBeenCalled();
    expect(authSmsService.sendLoginCode).not.toHaveBeenCalled();
  });

  it('purely-club 登录验证码接口仅对已注册手机号发码', async () => {
    prismaService.user.findFirst.mockResolvedValue({
      id: 7,
      email: 'club_phone_13800138000@purelyprofit.local',
      password: 'hashed',
    });
    redisService.set.mockResolvedValue(undefined);
    authSmsService.sendLoginCode.mockResolvedValue(undefined);

    const result = await authProductAuthService.sendLoginCode(
      {
        phone: '13800138000',
      },
      'purely_club',
    );

    expect(result.message).toBe(
      '如手机号已注册，登录验证码短信已发送，请注意查收',
    );
    expect(result.expiresInSeconds).toBe(600);
    expect(result.code).toMatch(/^\d{6}$/);
    expect(redisService.setIfAbsent).toHaveBeenCalledWith(
      'auth:sms-cooldown:login:purely_club:13800138000',
      '1',
      60,
    );
    expect(redisService.set).toHaveBeenCalledWith(
      'auth:register:purely_club:13800138000',
      result.code,
      600,
    );
    expect(authSmsService.sendLoginCode).toHaveBeenCalledWith({
      phone: '13800138000',
      code: result.code,
      expiresInSeconds: 600,
    });
  });

  it('purely-club 登录验证码发送在冷却期内会拒绝再次发送', async () => {
    prismaService.user.findFirst.mockResolvedValue({
      id: 7,
      email: 'club_phone_13800138000@purelyprofit.local',
      password: 'hashed',
    });
    redisService.setIfAbsent.mockResolvedValue(false);

    await expect(
      authProductAuthService.sendLoginCode(
        {
          phone: '13800138000',
        },
        'purely_club',
      ),
    ).rejects.toThrow('短信发送过于频繁，请 60 秒后再试');
    expect(redisService.set).not.toHaveBeenCalled();
    expect(authSmsService.sendLoginCode).not.toHaveBeenCalled();
  });

  it('purely-club 不存在手机号时发送登录验证码仍返回统一文案', async () => {
    prismaService.user.findFirst.mockResolvedValue(null);

    const result = await authProductAuthService.sendLoginCode(
      {
        phone: '13800138000',
      },
      'purely_club',
    );

    expect(result).toEqual({
      message: '如手机号已注册，登录验证码短信已发送，请注意查收',
      expiresInSeconds: 600,
    });
    expect(redisService.set).not.toHaveBeenCalled();
    expect(authSmsService.sendLoginCode).not.toHaveBeenCalled();
  });

  it('purely-club 支持通过短信验证码登录', async () => {
    prismaService.user.findFirst.mockResolvedValue({
      id: 7,
      email: 'club_phone_13800138000@purelyprofit.local',
      password: 'hashed-password',
    });
    redisService.get.mockResolvedValueOnce('0').mockResolvedValueOnce('123456');
    redisService.del.mockResolvedValue(undefined);
    jwtService.signAsync.mockResolvedValue('club-code-token');

    await expect(
      authProductAuthService.loginByCode(
        {
          phone: '13800138000',
          code: '123456',
        },
        'purely_club',
      ),
    ).resolves.toEqual(
      expect.objectContaining({ access_token: 'club-code-token', userId: 7 }),
    );

    expect(redisService.del).toHaveBeenCalledWith(
      'auth:register:purely_club:13800138000',
    );
    expect(jwtService.signAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: 7,
        phone: '13800138000',
        accountScope: 'purely_club',
        sessionVersion: 0,
      }),
    );
  });

  it('purely-club 验证码登录在验证码无效时拒绝登录', async () => {
    redisService.get.mockResolvedValue(null);

    await expect(
      authProductAuthService.loginByCode(
        {
          phone: '13800138000',
          code: '123456',
        },
        'purely_club',
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('purely-club 登录即注册在手机号未注册时自动创建账号', async () => {
    prismaService.user.findFirst.mockResolvedValue(null);
    prismaService.user.create.mockResolvedValueOnce({
      id: 77,
      email: 'club_phone_13800138000@purelyprofit.local',
    });
    redisService.get.mockResolvedValueOnce('0').mockResolvedValueOnce('123456');
    redisService.del.mockResolvedValue(undefined);
    jwtService.signAsync.mockResolvedValue('club-auto-register-token');

    await expect(
      authProductAuthService.loginByCodeOrRegister(
        {
          phone: '13800138000',
          code: '123456',
        },
        'purely_club',
      ),
    ).resolves.toEqual({
      access_token: 'club-auto-register-token',
      userId: 77,
    });

    expect(prismaService.user.create).toHaveBeenCalledWith({
      data: {
        email: 'club_phone_13800138000@purelyprofit.local',
        password: aNonEmptyString,
        name: undefined,
      },
      select: {
        id: true,
        email: true,
      },
    });
    expect(jwtService.signAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: 77,
        phone: '13800138000',
        accountScope: 'purely_club',
        sessionVersion: 0,
      }),
    );
  });

  it('purely-club 微信登录会使用稳定的 club wechat 标识签 token', async () => {
    prismaService.user.findUnique.mockResolvedValue(null);
    prismaService.user.findFirst.mockResolvedValueOnce(null);
    prismaService.user.create.mockResolvedValueOnce({
      id: 88,
      email: 'club_wechat_oOPENID123@purelyprofit.local',
    });
    redisService.get.mockResolvedValue('0');
    jwtService.signAsync.mockResolvedValue('club-wechat-token');

    await expect(
      authProductAuthService.wechatLogin(
        {
          openid: 'oOPENID123',
          nickname: '小王',
          avatar: 'https://cdn.example.com/avatar.png',
        },
        'purely_club',
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        access_token: 'club-wechat-token',
        userId: 88,
      }),
    );

    expect(jwtService.signAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: 88,
        phone: 'club_wechat:oOPENID123',
        accountScope: 'purely_club',
        sessionVersion: 0,
      }),
    );
  });

  it('purely-club 微信登录拿到真实手机号后，手机号登录会复用同一账号', async () => {
    prismaService.user.findFirst.mockReset();
    prismaService.user.create.mockReset();
    jwtService.signAsync.mockReset();
    redisService.get.mockReset();
    redisService.del.mockReset();

    prismaService.user.findFirst
      .mockResolvedValueOnce({
        id: 88,
        email: 'club_wechat_oOPENID123@purelyprofit.local',
        password: 'hashed-password',
      })
      .mockResolvedValueOnce({
        id: 88,
        email: 'club_wechat_oOPENID123@purelyprofit.local',
        password: 'hashed-password',
      });
    redisService.get.mockResolvedValueOnce('0').mockResolvedValueOnce('123456');
    redisService.del.mockResolvedValue(undefined);
    jwtService.signAsync.mockResolvedValue('club-phone-reuse-token');

    await expect(
      authProductAuthService.loginByCodeOrRegister(
        {
          phone: '13800138000',
          code: '123456',
        },
        'purely_club',
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        access_token: 'club-phone-reuse-token',
        userId: 88,
      }),
    );

    expect(prismaService.user.create).not.toHaveBeenCalled();
    expect(jwtService.signAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: 88,
        phone: '13800138000',
        accountScope: 'purely_club',
        sessionVersion: 0,
      }),
    );
  });

  it('purely-club 微信登录传入手机号时，会优先合并已有手机号账号', async () => {
    prismaService.user.findUnique.mockReset();
    prismaService.user.findFirst.mockReset();
    prismaService.user.update.mockReset();
    prismaService.user.create.mockReset();
    jwtService.signAsync.mockReset();
    redisService.get.mockReset();

    prismaService.user.findUnique.mockResolvedValue(null);
    prismaService.user.findFirst.mockResolvedValueOnce({
      id: 66,
      email: 'club_phone_13800138000@purelyprofit.local',
      password: 'hashed-password',
    });
    prismaService.user.update.mockResolvedValue(undefined);
    redisService.get.mockResolvedValue('0');
    jwtService.signAsync.mockResolvedValue('club-wechat-merge-token');

    await expect(
      authProductAuthService.wechatLogin(
        {
          openid: 'oOPENID456',
          unionid: 'union-456',
          nickname: '阿杰',
          avatar: 'https://cdn.example.com/avatar-456.png',
          phone: '13800138000',
        },
        'purely_club',
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        access_token: 'club-wechat-merge-token',
        userId: 66,
      }),
    );

    expect(prismaService.user.update).toHaveBeenCalledWith({
      where: { id: 66 },
      data: {
        wechatOpenid: 'oOPENID456',
        wechatUnionid: 'union-456',
        wechatNickname: '阿杰',
        wechatAvatar: 'https://cdn.example.com/avatar-456.png',
        wechatPhone: '13800138000',
      },
    });
    expect(prismaService.user.create).not.toHaveBeenCalled();
    expect(jwtService.signAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: 66,
        phone: '13800138000',
        accountScope: 'purely_club',
        sessionVersion: 0,
      }),
    );
  });

  it('微信资料回写会在通用昵称头像为空时做回填', async () => {
    prismaService.user.findUnique.mockResolvedValueOnce({
      name: null,
      avatar: null,
    });
    prismaService.user.update.mockResolvedValue(undefined);

    await authProfileService.updateWechatProfile(9, {
      nickname: '微信昵称',
      avatar: 'https://cdn.example.com/wx.png',
      unionid: 'union-1',
    });

    expect(prismaService.user.update).toHaveBeenCalledWith({
      where: { id: 9 },
      data: {
        wechatNickname: '微信昵称',
        name: '微信昵称',
        wechatAvatar: 'https://cdn.example.com/wx.png',
        avatar: 'https://cdn.example.com/wx.png',
        wechatUnionid: 'union-1',
      },
    });
  });

  it('验证码无效或过期时不允许重置密码', async () => {
    redisService.get.mockResolvedValue(null);

    await expect(
      service.resetPassword({
        phone: '13800138000',
        code: '123456',
        password: 'newPassword123',
        confirmPassword: 'newPassword123',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('新密码不能与旧密码相同', async () => {
    const hashedPassword = await bcrypt.hash('samePassword123', 4);
    // 区分验证码 key 和尝试次数 key 的 mock 返回值
    redisService.get.mockImplementation((key: string) => {
      if (key.includes('code-attempts')) return Promise.resolve('0');
      return Promise.resolve('123456');
    });
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
        confirmPassword: 'samePassword123',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prismaService.user.update).not.toHaveBeenCalled();
  });

  it('微信登录用户获取 profile 时不回显内部标识到手机号字段', async () => {
    prismaService.user.findUnique.mockResolvedValueOnce({
      id: 9,
      email: 'club_wechat_oOPENID123@purelyprofit.local',
      name: '微信用户',
      avatar: 'https://cdn.example.com/wx.png',
      realName: null,
      idNumber: null,
      createdAt: new Date('2026-05-12T10:00:00.000Z'),
      updatedAt: new Date('2026-05-13T10:00:00.000Z'),
      lastActiveAt: null,
    });
    prismaService.$queryRaw = jest.fn().mockResolvedValue([]);

    const result = await service.getProfile({
      id: 9,
      email: 'club_wechat_oOPENID123@purelyprofit.local',
      phone: 'club_wechat:oOPENID123',
      name: '微信用户',
      createdAt: new Date('2026-05-12T10:00:00.000Z'),
      updatedAt: new Date('2026-05-13T10:00:00.000Z'),
      lastActiveAt: null,
      accountScope: 'purely_club',
      currentMembership: null,
    });

    expect(result.user.phone).toBe('');
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
      lastActiveAt: null,
    });
    prismaService.$queryRaw = jest.fn().mockResolvedValue([]);

    const result = await service.getProfile({
      id: 1,
      email: 'phone_13800138000@purelyprofit.local',
      phone: '13800138000',
      name: '测试用户',
      createdAt: new Date('2026-05-12T10:00:00.000Z'),
      updatedAt: new Date('2026-05-13T10:00:00.000Z'),
      lastActiveAt: null,
      accountScope: 'purely_profit',
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
      lastActiveAt: null,
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
      lastActiveAt: null,
      accountScope: 'purely_profit',
      currentMembership: {
        staffId: 55,
        storeId: 48,
        role: 'staff',
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
        lastActiveAt: null,
        currentMembership: {
          staffId: 55,
          storeId: 48,
          role: 'staff',
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
      allowedHomeModules: [
        'additional',
        'space-management',
        'handover-management',
      ],
      canUseGoodsManagement: false,
      canUseHandoverManagement: true,
      canUseSpaceManagement: true,
    });
  });

  it('更新昵称后返回最新 profile', async () => {
    prismaService.user.update.mockResolvedValue(undefined);
    prismaService.user.findUnique.mockResolvedValueOnce({
      id: 1,
      email: 'phone_13800138000@purelyprofit.local',
      name: '新昵称',
      avatar: '',
      realName: null,
      idNumber: null,
      createdAt: new Date('2026-05-12T10:00:00.000Z'),
      updatedAt: new Date('2026-05-13T10:00:00.000Z'),
      lastActiveAt: null,
    });
    prismaService.$queryRaw = jest.fn().mockResolvedValue([]);

    const result = await service.updateNickname(
      {
        id: 1,
        email: 'phone_13800138000@purelyprofit.local',
        phone: '13800138000',
        name: '测试用户',
        createdAt: new Date('2026-05-12T10:00:00.000Z'),
        updatedAt: new Date('2026-05-13T10:00:00.000Z'),
        lastActiveAt: null,
        currentMembership: null,
      },
      '新昵称',
    );

    expect(prismaService.user.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { name: '新昵称' },
    });
    expect(result.user.name).toBe('新昵称');
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
      lastActiveAt: null,
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
        lastActiveAt: null,
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
          lastActiveAt: null,
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
