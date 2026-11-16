import { InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { RedisLockService } from '../../redis/redis-lock.service';
import { RedisService } from '../../redis/redis.service';
import { ClubWechatAuthService } from './club-wechat-auth.service';

/** 微信 getPhoneNumber 的成功响应体 */
const PHONE_OK = {
  errcode: 0,
  phone_info: { phoneNumber: '+8613', purePhoneNumber: '138' },
};

describe('ClubWechatAuthService', () => {
  let service: ClubWechatAuthService;

  const configService = {
    get: jest.fn((key: string) => {
      if (key === 'wechat.appId') return 'wx-app-id';
      if (key === 'wechat.appSecret') return 'wx-app-secret';
      return undefined;
    }),
  };
  const redisService = { get: jest.fn(), set: jest.fn() };
  const redisLockService = {
    acquireLock: jest.fn(),
    releaseLock: jest.fn(),
  };

  /** 按顺序返回预设响应体的 fetch 替身 */
  const mockFetch = (...payloads: unknown[]): jest.Mock => {
    const fetchMock = jest.fn();
    for (const payload of payloads) {
      fetchMock.mockResolvedValueOnce({
        json: () => Promise.resolve(payload),
      });
    }
    jest.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);
    return fetchMock;
  };

  const calledUrls = (fetchMock: jest.Mock): string[] =>
    fetchMock.mock.calls.map((call) => String(call[0]));

  beforeEach(async () => {
    jest.clearAllMocks();
    redisService.get.mockResolvedValue(null);
    redisService.set.mockResolvedValue(undefined);
    redisLockService.acquireLock.mockResolvedValue({
      resource: 'club-wechat-access-token:refresh:wx-app-id',
      token: 'token-1',
      key: 'distributed-lock:club-wechat-access-token:refresh:wx-app-id',
    });
    redisLockService.releaseLock.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClubWechatAuthService,
        { provide: ConfigService, useValue: configService },
        { provide: RedisService, useValue: redisService },
        { provide: RedisLockService, useValue: redisLockService },
      ],
    }).compile();
    service = module.get(ClubWechatAuthService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('缓存命中时直接用缓存 token，不请求 cgi-bin/token', async () => {
    redisService.get.mockResolvedValue('cached-token');
    const fetchMock = mockFetch(PHONE_OK);

    await service.getPhoneNumber('code');

    const urls = calledUrls(fetchMock);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('access_token=cached-token');
    expect(urls[0]).not.toContain('cgi-bin/token');
    expect(redisService.set).not.toHaveBeenCalled();
  });

  it('未命中且抢到租约时只换一次 token 并写回既有缓存 key', async () => {
    const fetchMock = mockFetch({ access_token: 'fresh-token' }, PHONE_OK);

    await service.getPhoneNumber('code');

    const urls = calledUrls(fetchMock);
    expect(urls[0]).toContain('cgi-bin/token');
    expect(urls[1]).toContain('access_token=fresh-token');
    expect(redisService.set).toHaveBeenCalledWith(
      'club:wechat:access_token:wx-app-id',
      'fresh-token',
      6900,
    );
    expect(redisLockService.releaseLock).toHaveBeenCalled();
  });

  it('抢不到租约时等待其他 worker 写入的 token，不重复换取', async () => {
    redisLockService.acquireLock.mockResolvedValue(null);
    redisService.get
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('waited-token');
    const fetchMock = mockFetch(PHONE_OK);

    await service.getPhoneNumber('code');

    const urls = calledUrls(fetchMock);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('access_token=waited-token');
    expect(redisService.set).not.toHaveBeenCalled();
  });

  it('Redis 读异常时按未命中处理并直连微信', async () => {
    redisService.get.mockRejectedValue(new Error('redis down'));
    const fetchMock = mockFetch({ access_token: 'fallback' }, PHONE_OK);

    await expect(service.getPhoneNumber('code')).resolves.toEqual({
      phoneNumber: '+8613',
      purePhoneNumber: '138',
    });
    expect(calledUrls(fetchMock)[0]).toContain('cgi-bin/token');
  });

  it('锁异常时仍能直连微信换取 token（登录链路不得失败）', async () => {
    redisLockService.acquireLock.mockRejectedValue(new Error('redis down'));
    const fetchMock = mockFetch({ access_token: 'fallback' }, PHONE_OK);

    await expect(service.getPhoneNumber('code')).resolves.toEqual({
      phoneNumber: '+8613',
      purePhoneNumber: '138',
    });
    expect(calledUrls(fetchMock)[1]).toContain('access_token=fallback');
  });

  it('微信未返回 token 时抛 500，且不写缓存', async () => {
    mockFetch({ errcode: 40013, errmsg: 'invalid appid' });

    await expect(service.getPhoneNumber('code')).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
    expect(redisService.set).not.toHaveBeenCalled();
  });
});
