import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuthSessionService } from './auth-session.service';
import { RedisService } from '../../redis/redis.service';

describe('AuthSessionService – Refresh Token', () => {
  let service: AuthSessionService;
  const mockRedis = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    delMany: jest.fn(),
    getJson: jest.fn(),
    setJson: jest.fn(),
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
        expect.any(Number),
      );
    });
  });
});
