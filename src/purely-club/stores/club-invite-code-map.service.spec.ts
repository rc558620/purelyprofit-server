import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisLockService } from '../../redis/redis-lock.service';
import { RedisService } from '../../redis/redis.service';
import { ClubInviteCodeMapService } from './club-invite-code-map.service';

describe('ClubInviteCodeMapService', () => {
  let service: ClubInviteCodeMapService;

  const prisma = {
    storeInviteCode: { findMany: jest.fn() },
    store: { findFirst: jest.fn() },
  };
  const redisService = {
    getJson: jest.fn(),
    setJson: jest.fn(),
  };
  const redisLockService = {
    acquireLock: jest.fn(),
    releaseLock: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.storeInviteCode.findMany.mockResolvedValue([
      { code: 'ABC123', storeId: 42 },
    ]);
    prisma.store.findFirst.mockResolvedValue({ id: 42 });
    redisService.getJson.mockResolvedValue(null);
    redisService.setJson.mockResolvedValue(undefined);
    redisLockService.acquireLock.mockResolvedValue({
      resource: 'club-invite-code-map:refresh',
      token: 'token-1',
      key: 'distributed-lock:club-invite-code-map:refresh',
    });
    redisLockService.releaseLock.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClubInviteCodeMapService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redisService },
        { provide: RedisLockService, useValue: redisLockService },
      ],
    }).compile();
    service = module.get(ClubInviteCodeMapService);
  });

  it('缓存命中时直接用缓存，不查库也不抢锁', async () => {
    redisService.getJson.mockResolvedValue({ ABC123: 42 });

    const map = await service.loadInviteCodeMap();

    expect(map.get('ABC123')).toBe(42);
    expect(prisma.storeInviteCode.findMany).not.toHaveBeenCalled();
    expect(redisLockService.acquireLock).not.toHaveBeenCalled();
  });

  it('未命中且抢到租约时全表构建一次并回写缓存', async () => {
    const map = await service.loadInviteCodeMap();

    expect(map.get('ABC123')).toBe(42);
    expect(prisma.storeInviteCode.findMany).toHaveBeenCalledTimes(1);
    expect(redisService.setJson).toHaveBeenCalledWith(
      'club:invite-code-map',
      { ABC123: 42 },
      3600,
    );
    expect(redisLockService.releaseLock).toHaveBeenCalled();
  });

  it('抢不到租约时等待缓存出现，不重复全表拉取', async () => {
    redisLockService.acquireLock.mockResolvedValue(null);
    redisService.getJson
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ABC123: 7 });

    const map = await service.loadInviteCodeMap();

    expect(map.get('ABC123')).toBe(7);
    expect(prisma.storeInviteCode.findMany).not.toHaveBeenCalled();
  });

  it('抢不到租约且等待超时时兜底查库，仍能解析邀请码', async () => {
    redisLockService.acquireLock.mockResolvedValue(null);

    const map = await service.loadInviteCodeMap();

    expect(map.get('ABC123')).toBe(42);
    expect(prisma.storeInviteCode.findMany).toHaveBeenCalledTimes(1);
  });

  it('Redis 读异常时降级为回源，不抛错', async () => {
    redisService.getJson.mockRejectedValue(new Error('redis down'));

    const map = await service.loadInviteCodeMap();

    expect(map.get('ABC123')).toBe(42);
  });

  it('Redis 写异常不影响映射结果', async () => {
    redisService.setJson.mockRejectedValue(new Error('redis down'));

    const map = await service.loadInviteCodeMap();

    expect(map.get('ABC123')).toBe(42);
  });

  it('抢锁异常时仍能兜底回源（邀请码解析不得失败）', async () => {
    redisLockService.acquireLock.mockRejectedValue(new Error('redis down'));

    const map = await service.loadInviteCodeMap();

    expect(map.get('ABC123')).toBe(42);
  });

  it('按邀请码查到门店；邀请码不存在时返回 null 且不查门店表', async () => {
    redisService.getJson.mockResolvedValue({ ABC123: 42 });

    await expect(service.findStoreByInviteCode('ABC123')).resolves.toEqual({
      id: 42,
    });

    prisma.store.findFirst.mockClear();
    await expect(service.findStoreByInviteCode('NOPE')).resolves.toBeNull();
    expect(prisma.store.findFirst).not.toHaveBeenCalled();
  });
});
