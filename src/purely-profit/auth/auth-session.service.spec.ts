import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuthSessionService } from './auth-session.service';
import { RedisService } from '../../redis/redis.service';
import { aNonNegativeNumber } from '../../spec-matchers';

describe('AuthSessionService – Refresh Token', () => {
  let service: AuthSessionService;
  const mockRedis = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    delMany: jest.fn(),
    getJson: jest.fn(),
    setJson: jest.fn(),
    zadd: jest.fn(),
    zcard: jest.fn(),
    zrange: jest.fn(),
    zremrangebyrank: jest.fn(),
    zscore: jest.fn(),
    mget: jest.fn(),
  };
  const mockJwt = {
    signAsync: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockRedis.get.mockResolvedValue(null);
    mockRedis.set.mockResolvedValue(undefined);
    mockRedis.del.mockResolvedValue(undefined);
    mockRedis.delMany.mockResolvedValue(0);
    mockRedis.getJson.mockResolvedValue(null);
    mockRedis.setJson.mockResolvedValue(undefined);
    mockRedis.zadd.mockResolvedValue(undefined);
    mockRedis.zcard.mockResolvedValue(0);
    mockRedis.zrange.mockResolvedValue([]);
    mockRedis.zremrangebyrank.mockResolvedValue(0);
    mockRedis.zscore.mockResolvedValue(null);
    mockRedis.mget.mockResolvedValue([]);
    mockJwt.signAsync.mockResolvedValue('mock-jwt-token');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthSessionService,
        {
          provide: RedisService,
          useValue: mockRedis,
        },
        { provide: JwtService, useValue: mockJwt },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              const config: Record<string, string | number | undefined> = {
                'auth.refreshTokenTtlSeconds': 2592000,
                'jwt.expiresIn': '7d',
              };
              return config[key];
            },
          },
        },
      ],
    }).compile();

    service = module.get(AuthSessionService);
  });

  describe('signToken', () => {
    it('返回 access_token + refresh_token + expires_in + userId', async () => {
      const result = await service.signToken(42, {
        phone: '13800138000',
        email: 'phone_138@purelyprofit.local',
        accountScope: 'purely_profit',
      });

      expect(result.access_token).toBe('mock-jwt-token');
      expect(result.refresh_token).toMatch(/^rt_[a-f0-9]{64}$/);
      expect(result.expires_in).toBe(604800); // 7 days in seconds
      expect(result.userId).toBe(42);
    });

    it('refresh_token 的 hash 存入 Redis', async () => {
      await service.signToken(42, {
        phone: '13800138000',
        email: 'phone_138@purelyprofit.local',
        accountScope: 'purely_profit',
      });

      // setJson 应被调用 2 次：token payload + user-index
      expect(mockRedis.setJson).toHaveBeenCalledTimes(2);

      // 第一次调用存储 token payload
      const [key, payload, ttl] = mockRedis.setJson.mock.calls[0];
      expect(key).toMatch(/^auth:refresh-token:[a-f0-9]{64}$/);
      expect(payload).toEqual({
        userId: 42,
        phone: '13800138000',
        email: 'phone_138@purelyprofit.local',
        accountScope: 'purely_profit',
      });
      expect(ttl).toBe(2592000); // 30 days
    });

    it('维护 userId 索引', async () => {
      await service.signToken(42, {
        phone: '13800138000',
        email: 'phone_138@purelyprofit.local',
        accountScope: 'purely_profit',
      });

      // 第二次调用存储 user-index
      const [indexKey, indexPayload] = mockRedis.setJson.mock.calls[1];
      expect(indexKey).toBe('auth:refresh-token:user-index:42');
      expect(Array.isArray(indexPayload)).toBe(true);
      expect(indexPayload).toHaveLength(1);
    });
  });

  describe('refreshAccessToken', () => {
    it('有效 refresh_token 返回新 token pair', async () => {
      // 先签发一个 token
      const original = await service.signToken(42, {
        phone: '13800138000',
        email: 'phone_138@purelyprofit.local',
        accountScope: 'purely_profit',
      });

      // 模拟 Redis 查找
      mockRedis.getJson.mockImplementation((key: string) => {
        if (key.startsWith('auth:refresh-token:user-index:')) {
          return Promise.resolve([]);
        }
        // 对 token hash key 返回 payload
        return Promise.resolve({
          userId: 42,
          phone: '13800138000',
          email: 'phone_138@purelyprofit.local',
          accountScope: 'purely_profit',
        });
      });

      const result = await service.refreshAccessToken(original.refresh_token!);

      expect(result).not.toBeNull();
      expect(result!.access_token).toBe('mock-jwt-token');
      expect(result!.refresh_token).toMatch(/^rt_[a-f0-9]{64}$/);
      // 新 refresh_token 应与旧的不同
      expect(result!.refresh_token).not.toBe(original.refresh_token);
    });

    it('无效 refresh_token 返回 null', async () => {
      mockRedis.getJson.mockResolvedValue(null);

      const result = await service.refreshAccessToken('rt_invalid_token');

      expect(result).toBeNull();
    });

    it('消费后旧 token 被删除', async () => {
      const original = await service.signToken(42, {
        phone: '13800138000',
        email: 'phone_138@purelyprofit.local',
        accountScope: 'purely_profit',
      });

      mockRedis.getJson.mockImplementation((key: string) => {
        if (key.startsWith('auth:refresh-token:user-index:')) {
          return Promise.resolve([]);
        }
        return Promise.resolve({
          userId: 42,
          phone: '13800138000',
          email: 'phone_138@purelyprofit.local',
          accountScope: 'purely_profit',
        });
      });

      await service.refreshAccessToken(original.refresh_token!);

      // del 应被调用以消费旧 token
      expect(mockRedis.del).toHaveBeenCalled();
    });
  });

  describe('invalidateAllRefreshTokens', () => {
    it('通过 user-index 批量删除', async () => {
      const hashes = ['hash1', 'hash2', 'hash3'];
      mockRedis.getJson.mockImplementation((key: string) => {
        if (key === 'auth:refresh-token:user-index:42') {
          return Promise.resolve(hashes);
        }
        return Promise.resolve(null);
      });

      await service.invalidateAllRefreshTokens(42);

      // delMany 应被调用删除所有 token key
      expect(mockRedis.delMany).toHaveBeenCalledWith([
        'auth:refresh-token:hash1',
        'auth:refresh-token:hash2',
        'auth:refresh-token:hash3',
      ]);

      // 索引也应被删除
      expect(mockRedis.del).toHaveBeenCalledWith(
        'auth:refresh-token:user-index:42',
      );
    });

    it('无 token 时不报错', async () => {
      mockRedis.getJson.mockResolvedValue(null);

      await expect(
        service.invalidateAllRefreshTokens(999),
      ).resolves.toBeUndefined();
    });
  });

  describe('bumpTokenVersion', () => {
    it('递增 token version', async () => {
      mockRedis.get.mockResolvedValue('2');

      await service.bumpTokenVersion(42);

      expect(mockRedis.set).toHaveBeenCalledWith(
        expect.stringContaining('auth:token-version:42'),
        '3',
        aNonNegativeNumber,
      );
    });
  });

  describe('registerSession', () => {
    it('owner 账号无会话数限制，直接添加', async () => {
      mockRedis.zcard.mockResolvedValue(10);

      const sid = await service.registerSession(1, 'owner');

      expect(sid).toMatch(/^[a-f0-9]{32}$/);
      expect(mockRedis.zremrangebyrank).not.toHaveBeenCalled();
      expect(mockRedis.zadd).toHaveBeenCalledWith(
        'auth:sessions:1',
        expect.any(Number),
        sid,
        expect.any(Number),
      );
    });

    it('profit_main 账号未达上限时直接添加', async () => {
      mockRedis.zcard.mockResolvedValue(2);

      const sid = await service.registerSession(2, 'profit_main');

      expect(sid).toMatch(/^[a-f0-9]{32}$/);
      expect(mockRedis.zremrangebyrank).not.toHaveBeenCalled();
      expect(mockRedis.zadd).toHaveBeenCalled();
    });

    it('profit_main 账号达到 3 个上限时 FIFO 淘汰最老会话', async () => {
      mockRedis.zcard.mockResolvedValue(3);
      mockRedis.zrange.mockResolvedValue(['oldest-sid']);
      mockRedis.mget.mockResolvedValue(['hash-of-oldest']);

      const sid = await service.registerSession(3, 'profit_main');

      // 淘汰最老的 1 个会话并清理其 refresh token
      expect(mockRedis.zrange).toHaveBeenCalledWith('auth:sessions:3', 0, 0);
      expect(mockRedis.delMany).toHaveBeenCalled();
      expect(mockRedis.zremrangebyrank).toHaveBeenCalledWith(
        'auth:sessions:3',
        0,
        0,
      );
      expect(mockRedis.zadd).toHaveBeenCalled();
      expect(sid).toMatch(/^[a-f0-9]{32}$/);
    });

    it('profit_sub 账号只允许 1 个会话，踢掉旧的', async () => {
      mockRedis.zcard.mockResolvedValue(1);
      mockRedis.zrange.mockResolvedValue(['old-sid']);
      mockRedis.mget.mockResolvedValue(['old-hash']);

      const sid = await service.registerSession(4, 'profit_sub');

      expect(mockRedis.zremrangebyrank).toHaveBeenCalledWith(
        'auth:sessions:4',
        0,
        0,
      );
      expect(mockRedis.zadd).toHaveBeenCalled();
      expect(sid).toMatch(/^[a-f0-9]{32}$/);
    });

    it('profit_club 账号只允许 1 个会话，踢掉旧的', async () => {
      mockRedis.zcard.mockResolvedValue(1);
      mockRedis.zrange.mockResolvedValue(['old-sid']);
      mockRedis.mget.mockResolvedValue(['old-hash']);

      const sid = await service.registerSession(5, 'profit_club');

      expect(mockRedis.zremrangebyrank).toHaveBeenCalledWith(
        'auth:sessions:5',
        0,
        0,
      );
      expect(mockRedis.zadd).toHaveBeenCalled();
      expect(sid).toMatch(/^[a-f0-9]{32}$/);
    });
  });

  describe('isSessionActive', () => {
    it('会话在 sorted set 中时返回 true', async () => {
      mockRedis.zscore.mockResolvedValue('1720000000000');

      const active = await service.isSessionActive(1, 'abc123');

      expect(active).toBe(true);
      expect(mockRedis.zscore).toHaveBeenCalledWith(
        'auth:sessions:1',
        'abc123',
      );
    });

    it('会话不在 sorted set 中时返回 false', async () => {
      mockRedis.zscore.mockResolvedValue(null);

      const active = await service.isSessionActive(1, 'evicted-sid');

      expect(active).toBe(false);
    });
  });

  describe('removeAllSessions', () => {
    it('清除所有 refresh token 并删除会话列表', async () => {
      mockRedis.getJson.mockResolvedValue(['hash1', 'hash2']);

      await service.removeAllSessions(42);

      // 应删除所有 refresh token
      expect(mockRedis.delMany).toHaveBeenCalledWith([
        'auth:refresh-token:hash1',
        'auth:refresh-token:hash2',
      ]);
      // 应删除 user-index
      expect(mockRedis.del).toHaveBeenCalledWith(
        'auth:refresh-token:user-index:42',
      );
      // 应删除会话列表
      expect(mockRedis.del).toHaveBeenCalledWith('auth:sessions:42');
    });
  });

  describe('refreshAccessToken 会话校验', () => {
    it('已被踢下线的会话无法刷新 token', async () => {
      mockRedis.getJson.mockResolvedValue({
        userId: 42,
        phone: '13800138000',
        email: 'phone_138@purelyprofit.local',
        accountScope: 'purely_profit',
        sid: 'evicted-session-id',
      });
      // 会话已被踢出
      mockRedis.zscore.mockResolvedValue(null);

      const result = await service.refreshAccessToken('rt_' + 'a'.repeat(64));

      expect(result).toBeNull();
    });

    it('活跃会话可以正常刷新 token', async () => {
      mockRedis.getJson.mockImplementation((key: string) => {
        if (key.startsWith('auth:refresh-token:user-index:')) {
          return Promise.resolve([]);
        }
        return Promise.resolve({
          userId: 42,
          phone: '13800138000',
          email: 'phone_138@purelyprofit.local',
          accountScope: 'purely_profit',
          sid: 'active-session-id',
        });
      });
      // 会话仍然活跃
      mockRedis.zscore.mockResolvedValue('1720000000000');

      const result = await service.refreshAccessToken('rt_' + 'a'.repeat(64));

      expect(result).not.toBeNull();
      expect(result!.access_token).toBe('mock-jwt-token');
    });
  });
});
