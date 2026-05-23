import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  const prisma = {
    user: {
      findUnique: jest.fn(),
    },
    store: {
      findMany: jest.fn(),
    },
    $queryRaw: jest.fn(),
  };
  const accessControlService = {
    buildMembershipContext: jest.fn(),
  };
  const redisService = {
    get: jest.fn(),
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

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sessionVersion 过期时拒绝旧 token', async () => {
    const strategy = new JwtStrategy(
      configService as never,
      prisma as never,
      accessControlService as never,
      redisService as never,
    );

    prisma.user.findUnique.mockResolvedValue({
      id: 1,
      email: 'user@example.com',
      name: '测试用户',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    redisService.get.mockResolvedValue('2');

    await expect(
      strategy.validate({
        sub: 1,
        phone: '13800138000',
        sessionVersion: 1,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('命中开发者邮箱白名单时返回 developer 模式', async () => {
    const strategy = new JwtStrategy(
      configService as never,
      prisma as never,
      accessControlService as never,
      redisService as never,
    );

    prisma.user.findUnique.mockResolvedValue({
      id: 1,
      email: 'dev@example.com',
      name: '开发者',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    redisService.get.mockResolvedValue('0');
    prisma.store.findMany.mockResolvedValue([]);
    prisma.$queryRaw.mockResolvedValue([]);

    const result = await strategy.validate({
      sub: 1,
      phone: '13800138000',
      sessionVersion: 0,
    });

    expect(result).toMatchObject({
      pulseMode: 'developer',
      isPulseDeveloper: true,
    });
  });

  it('封禁后旧登录态会在鉴权阶段被拒绝', async () => {
    const strategy = new JwtStrategy(
      configService as never,
      prisma as never,
      accessControlService as never,
      redisService as never,
    );

    prisma.user.findUnique.mockResolvedValue({
      id: 18,
      email: 'user@example.com',
      name: '测试用户',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    prisma.store.findMany.mockResolvedValue([{ id: 18 }]);
    redisService.get.mockResolvedValueOnce('0').mockResolvedValueOnce('违规操作');

    await expect(
      strategy.validate({
        sub: 18,
        phone: '13800138000',
        sessionVersion: 0,
      }),
    ).rejects.toThrow('账号已被封禁');
  });

  it('sessionVersion 匹配时允许通过', async () => {
    const strategy = new JwtStrategy(
      configService as never,
      prisma as never,
      accessControlService as never,
      redisService as never,
    );

    prisma.user.findUnique.mockResolvedValue({
      id: 1,
      email: 'user@example.com',
      name: '测试用户',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    redisService.get.mockResolvedValue('2');
    prisma.store.findMany.mockResolvedValue([]);
    prisma.$queryRaw.mockResolvedValue([]);

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
    });
  });
});
