import type {
  DistributedLock,
  RedisLockService,
} from '../../redis/redis-lock.service';
import {
  CLUB_CACHE_LOAD_LOCK_LEASE_SECONDS,
  runClubLockedLoad,
  type ClubLockedLoadParams,
} from './club-cache-load-lock.helper';

describe('runClubLockedLoad', () => {
  const lock: DistributedLock = {
    resource: 'demo:refresh',
    token: 'token-1',
    key: 'distributed-lock:demo:refresh',
  };
  const lockService = {
    acquireLock: jest.fn(),
    releaseLock: jest.fn(),
  };
  const service = lockService as unknown as RedisLockService;

  const params = (
    overrides: Partial<ClubLockedLoadParams<string>> = {},
  ): ClubLockedLoadParams<string> => ({
    lockResource: 'demo:refresh',
    readCached: jest.fn().mockResolvedValue(null),
    loadAndPublish: jest.fn().mockResolvedValue('loaded'),
    waitAttempts: 2,
    waitIntervalMs: 0,
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    lockService.acquireLock.mockResolvedValue(lock);
    lockService.releaseLock.mockResolvedValue(undefined);
  });

  it('抢到租约且缓存仍为空时回源一次，并释放租约', async () => {
    const input = params();

    await expect(runClubLockedLoad(service, input)).resolves.toBe('loaded');

    expect(input.loadAndPublish).toHaveBeenCalledTimes(1);
    expect(lockService.acquireLock).toHaveBeenCalledWith('demo:refresh', {
      ttlSeconds: CLUB_CACHE_LOAD_LOCK_LEASE_SECONDS,
    });
    expect(lockService.releaseLock).toHaveBeenCalledWith(lock);
  });

  it('抢到租约后双检命中缓存则不回源', async () => {
    const input = params({
      readCached: jest.fn().mockResolvedValue('cached'),
    });

    await expect(runClubLockedLoad(service, input)).resolves.toBe('cached');

    expect(input.loadAndPublish).not.toHaveBeenCalled();
    expect(lockService.releaseLock).toHaveBeenCalledWith(lock);
  });

  it('抢不到租约时等待缓存出现，不重复回源', async () => {
    lockService.acquireLock.mockResolvedValue(null);
    const readCached = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('waited');
    const input = params({ readCached, waitAttempts: 3 });

    await expect(runClubLockedLoad(service, input)).resolves.toBe('waited');

    expect(input.loadAndPublish).not.toHaveBeenCalled();
    expect(readCached).toHaveBeenCalledTimes(2);
  });

  it('抢不到租约且等待预算耗尽时兜底直连回源', async () => {
    lockService.acquireLock.mockResolvedValue(null);
    const input = params();

    await expect(runClubLockedLoad(service, input)).resolves.toBe('loaded');

    expect(input.loadAndPublish).toHaveBeenCalledTimes(1);
  });

  it('Redis 抢锁异常时直接回源，不抛错（登录/扫码降级底线）', async () => {
    lockService.acquireLock.mockRejectedValue(new Error('redis down'));
    const input = params();

    await expect(runClubLockedLoad(service, input)).resolves.toBe('loaded');

    expect(input.loadAndPublish).toHaveBeenCalledTimes(1);
  });

  it('重读缓存异常按未命中处理，仍在回源前正常返回', async () => {
    const input = params({
      readCached: jest.fn().mockRejectedValue(new Error('redis down')),
    });

    await expect(runClubLockedLoad(service, input)).resolves.toBe('loaded');

    expect(input.loadAndPublish).toHaveBeenCalledTimes(1);
  });

  it('释放租约异常不影响本次返回值', async () => {
    lockService.releaseLock.mockRejectedValue(new Error('redis down'));
    const input = params();

    await expect(runClubLockedLoad(service, input)).resolves.toBe('loaded');

    expect(input.loadAndPublish).toHaveBeenCalledTimes(1);
  });
});
