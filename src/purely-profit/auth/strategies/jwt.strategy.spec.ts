import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';
import { aValidDate } from '../../../spec-matchers';

describe('JwtStrategy', () => {
  const prisma = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const redisService = {
    getJson: jest.fn().mockResolvedValue(null),
    setJson: jest.fn().mockResolvedValue(undefined),
  };
  const authBanGuardService = {
    ensureUserNotBanned: jest.fn(),
  };
  const authMembershipResolverService = {
    resolveAuthenticatedMembership: jest.fn(),
  };
  const authSessionService = {
    getTokenVersion: jest.fn(),
    isSessionActive: jest.fn().mockResolvedValue(true),
  };
  const configService = {
    get: jest.fn().mockImplementation((key: string) => {
      if (key === 'jwt.secret') {
        return 'test-secret';
      }

      if (key === 'pulse.devAccountEmails') {
        return [' DEV@EXAMPLE.COM '];
      }

      return undefined;
    }),
  };

  const createStrategy = (): JwtStrategy =>
    new JwtStrategy(
      configService as never,
      prisma as never,
      redisService as never,
      authBanGuardService as never,
      authMembershipResolverService as never,
      authSessionService as never,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    authMembershipResolverService.resolveAuthenticatedMembership.mockResolvedValue(
      null,
    );
    authBanGuardService.ensureUserNotBanned.mockResolvedValue(undefined);
    authSessionService.getTokenVersion.mockResolvedValue(0);
  });

  it('sessionVersion 过期时拒绝旧 token', async () => {
    const strategy = createStrategy();

    prisma.user.findUnique.mockResolvedValue({
      id: 1,
      email: 'user@example.com',
      name: '测试用户',
      createdAt: new Date(),
      updatedAt: new Date(),
      lastActiveAt: null,
    });
    authSessionService.getTokenVersion.mockResolvedValue(2);

    await expect(
      strategy.validate({
        sub: 1,
        phone: '13800138000',
        sessionVersion: 1,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('命中开发者邮箱白名单时返回 developer 模式', async () => {
    const strategy = createStrategy();

    prisma.user.findUnique.mockResolvedValue({
      id: 1,
      email: 'dev@example.com',
      name: '开发者',
      createdAt: new Date(),
      updatedAt: new Date(),
      lastActiveAt: null,
    });

    const result = await strategy.validate({
      sub: 1,
      phone: '13800138000',
      sessionVersion: 0,
    });

    expect(result).toMatchObject({
      pulseMode: 'developer',
      isPulseDeveloper: true,
      accountScope: 'developer',
    });
  });

  it('admin 别名手机号登录时返回 developer 模式', async () => {
    const strategy = createStrategy();

    prisma.user.findUnique.mockResolvedValue({
      id: 2,
      email: 'phone_13619654020@purelyprofit.local',
      name: '管理员',
      createdAt: new Date(),
      updatedAt: new Date(),
      lastActiveAt: null,
    });

    const result = await strategy.validate({
      sub: 2,
      phone: '13619654020',
      sessionVersion: 0,
    });

    expect(result).toMatchObject({
      pulseMode: 'developer',
      isPulseDeveloper: true,
      accountScope: 'developer',
    });
  });

  it('封禁后旧登录态会在鉴权阶段被拒绝', async () => {
    const strategy = createStrategy();

    prisma.user.findUnique.mockResolvedValue({
      id: 18,
      email: 'user@example.com',
      name: '测试用户',
      createdAt: new Date(),
      updatedAt: new Date(),
      lastActiveAt: null,
    });
    authBanGuardService.ensureUserNotBanned.mockRejectedValue(
      new UnauthorizedException('账号已被封禁'),
    );

    await expect(
      strategy.validate({
        sub: 18,
        phone: '13800138000',
        sessionVersion: 0,
      }),
    ).rejects.toThrow('账号已被封禁');
  });

  it('sessionVersion 匹配时允许通过', async () => {
    const strategy = createStrategy();

    prisma.user.findUnique.mockResolvedValue({
      id: 1,
      email: 'user@example.com',
      name: '测试用户',
      createdAt: new Date(),
      updatedAt: new Date(),
      lastActiveAt: null,
    });
    authSessionService.getTokenVersion.mockResolvedValue(2);

    const result = await strategy.validate({
      sub: 1,
      phone: '13800138000',
      sessionVersion: 2,
    });

    expect(result).toMatchObject({
      id: 1,
      email: 'user@example.com',
      phone: '13800138000',
      currentMembership: null,
      accountScope: 'purely_profit',
    });
    expect(
      authMembershipResolverService.resolveAuthenticatedMembership,
    ).toHaveBeenCalledWith(
      {
        sub: 1,
        phone: '13800138000',
        sessionVersion: 2,
      },
      'user@example.com',
    );
  });

  it('membership 上下文未就绪时拒绝登录', async () => {
    const strategy = createStrategy();

    prisma.user.findUnique.mockResolvedValue({
      id: 9,
      email: 'owner@example.com',
      name: '老板',
      createdAt: new Date(),
      updatedAt: new Date(),
      lastActiveAt: null,
    });
    authMembershipResolverService.resolveAuthenticatedMembership.mockRejectedValue(
      new UnauthorizedException(
        '登录态能力上下文未就绪，请联系管理员完成系统升级后重试',
      ),
    );

    await expect(
      strategy.validate({
        sub: 9,
        phone: '13800138000',
        sessionVersion: 0,
      }),
    ).rejects.toThrow('登录态能力上下文未就绪，请联系管理员完成系统升级后重试');
  });

  it('lastActiveAt 为 null 时异步更新', async () => {
    const strategy = createStrategy();

    prisma.user.findUnique.mockResolvedValue({
      id: 1,
      email: 'user@example.com',
      name: '测试用户',
      createdAt: new Date(),
      updatedAt: new Date(),
      lastActiveAt: null,
    });
    prisma.user.update = jest.fn().mockResolvedValue({});

    const result = await strategy.validate({
      sub: 1,
      phone: '13800138000',
      sessionVersion: 0,
    });

    expect(result.lastActiveAt).toBeInstanceOf(Date);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { lastActiveAt: aValidDate },
    });
  });

  it('lastActiveAt 在 5 分钟内时不更新（节流）', async () => {
    const strategy = createStrategy();
    const recentTime = new Date();

    prisma.user.findUnique.mockResolvedValue({
      id: 1,
      email: 'user@example.com',
      name: '测试用户',
      createdAt: new Date(),
      updatedAt: new Date(),
      lastActiveAt: recentTime,
    });
    prisma.user.update = jest.fn().mockResolvedValue({});

    const result = await strategy.validate({
      sub: 1,
      phone: '13800138000',
      sessionVersion: 0,
    });

    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(result.lastActiveAt).toBe(recentTime);
  });

  it('有 sid 且会话活跃时允许通过', async () => {
    const strategy = createStrategy();

    prisma.user.findUnique.mockResolvedValue({
      id: 1,
      email: 'user@example.com',
      name: '测试用户',
      createdAt: new Date(),
      updatedAt: new Date(),
      lastActiveAt: null,
    });
    authSessionService.isSessionActive.mockResolvedValue(true);

    const result = await strategy.validate({
      sub: 1,
      phone: '13800138000',
      sessionVersion: 0,
      sid: 'active-session-id',
    });

    expect(authSessionService.isSessionActive).toHaveBeenCalledWith(
      1,
      'active-session-id',
    );
    expect(result.id).toBe(1);
  });

  it('有 sid 但会话已被淘汰时拒绝访问', async () => {
    const strategy = createStrategy();

    prisma.user.findUnique.mockResolvedValue({
      id: 1,
      email: 'user@example.com',
      name: '测试用户',
      createdAt: new Date(),
      updatedAt: new Date(),
      lastActiveAt: null,
    });
    authSessionService.isSessionActive.mockResolvedValue(false);

    await expect(
      strategy.validate({
        sub: 1,
        phone: '13800138000',
        sessionVersion: 0,
        sid: 'evicted-session-id',
      }),
    ).rejects.toThrow('您的账号已在其他设备登录，当前会话已失效');
  });

  it('无 sid 的旧 token 跳过会话检查', async () => {
    const strategy = createStrategy();

    prisma.user.findUnique.mockResolvedValue({
      id: 1,
      email: 'user@example.com',
      name: '测试用户',
      createdAt: new Date(),
      updatedAt: new Date(),
      lastActiveAt: null,
    });

    const result = await strategy.validate({
      sub: 1,
      phone: '13800138000',
      sessionVersion: 0,
    });

    expect(authSessionService.isSessionActive).not.toHaveBeenCalled();
    expect(result.id).toBe(1);
  });
});
