import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';
import { aValidDate } from '../../../spec-matchers';
import type { ResolvedAuthUserRecord } from '../auth-user-cache.service';

/**
 * 本 spec 只验证 strategy 自身的判定与副作用（抛错文案、lastActiveAt 节流、
 * membership 依赖关系）。Redis 批量读取/降级与封禁判定由
 * auth-validate-context.service.spec.ts 覆盖，两边合起来等价于合并前的覆盖范围。
 */
describe('JwtStrategy', () => {
  const buildUser = (
    overrides: Partial<ResolvedAuthUserRecord> = {},
  ): ResolvedAuthUserRecord => ({
    id: 1,
    email: 'user@example.com',
    name: '测试用户',
    createdAt: new Date(),
    updatedAt: new Date(),
    lastActiveAt: null,
    ...overrides,
  });

  const prisma = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const authMembershipResolverService = {
    resolveAuthenticatedMembership: jest.fn(),
  };
  const authValidateContextService = {
    load: jest.fn(),
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
      authMembershipResolverService as never,
      authValidateContextService as never,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.user.update = jest.fn().mockResolvedValue({});
    authMembershipResolverService.resolveAuthenticatedMembership.mockResolvedValue(
      null,
    );
    authValidateContextService.load.mockResolvedValue({
      user: buildUser(),
      currentTokenVersion: 0,
      sessionActive: true,
    });
  });

  it('sessionVersion 过期时拒绝旧 token', async () => {
    const strategy = createStrategy();

    authValidateContextService.load.mockResolvedValue({
      user: buildUser(),
      currentTokenVersion: 2,
      sessionActive: true,
    });

    await expect(
      strategy.validate({
        sub: 1,
        phone: '13800138000',
        sessionVersion: 1,
      }),
    ).rejects.toThrow('登录态已失效，请重新登录');
  });

  it('用户不存在时拒绝访问', async () => {
    const strategy = createStrategy();

    authValidateContextService.load.mockResolvedValue({
      user: null,
      currentTokenVersion: 0,
      sessionActive: true,
    });

    await expect(
      strategy.validate({
        sub: 1,
        phone: '13800138000',
        sessionVersion: 0,
      }),
    ).rejects.toThrow('用户不存在');
  });

  it('命中开发者邮箱白名单时返回 developer 模式', async () => {
    const strategy = createStrategy();

    authValidateContextService.load.mockResolvedValue({
      user: buildUser({ email: 'dev@example.com', name: '开发者' }),
      currentTokenVersion: 0,
      sessionActive: true,
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

    authValidateContextService.load.mockResolvedValue({
      user: buildUser({
        id: 2,
        email: 'phone_13619654020@purelyprofit.local',
        name: '管理员',
      }),
      currentTokenVersion: 0,
      sessionActive: true,
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

    authValidateContextService.load.mockRejectedValue(
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

    authValidateContextService.load.mockResolvedValue({
      user: buildUser(),
      currentTokenVersion: 2,
      sessionActive: true,
    });

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

    authValidateContextService.load.mockResolvedValue({
      user: buildUser({ id: 9, email: 'owner@example.com', name: '老板' }),
      currentTokenVersion: 0,
      sessionActive: true,
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

    authValidateContextService.load.mockResolvedValue({
      user: buildUser({ lastActiveAt: recentTime }),
      currentTokenVersion: 0,
      sessionActive: true,
    });

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

    const result = await strategy.validate({
      sub: 1,
      phone: '13800138000',
      sessionVersion: 0,
      sid: 'active-session-id',
    });

    expect(result.id).toBe(1);
  });

  it('有 sid 但会话已被淘汰时拒绝访问', async () => {
    const strategy = createStrategy();

    authValidateContextService.load.mockResolvedValue({
      user: buildUser(),
      currentTokenVersion: 0,
      sessionActive: false,
    });

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

    const result = await strategy.validate({
      sub: 1,
      phone: '13800138000',
      sessionVersion: 0,
    });

    expect(result.id).toBe(1);
    expect(authValidateContextService.load).toHaveBeenCalledWith({
      sub: 1,
      phone: '13800138000',
      sessionVersion: 0,
    });
  });
});
