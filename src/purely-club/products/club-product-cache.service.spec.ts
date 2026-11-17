import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisReadPrefetchService } from '../../redis/redis-read-prefetch.service';
import { RedisService } from '../../redis/redis.service';
import { buildClubProductsVersionCacheKey } from '../../redis/keys/club-cache-keys';
import { ClubProductCacheService } from './club-product-cache.service';
import type { ClubProductRecord } from './club-products.types';

describe('ClubProductCacheService', () => {
  let service: ClubProductCacheService;
  let cacheStore: Map<string, unknown>;

  const prismaService = {
    marketingProduct: { aggregate: jest.fn() },
  };
  const redisService = {
    getJson: jest.fn(),
    setJson: jest.fn(),
  };
  /** 本文件不覆盖预取语义：peekJson 恒为 undefined，等价于「未预取」 */
  const redisReadPrefetch = {
    peekJson: jest.fn(),
  };

  const versionKey = buildClubProductsVersionCacheKey(11);
  const maxUpdatedAt = new Date('2026-06-02T00:00:00.000Z');

  const buildRecord = (): ClubProductRecord => ({
    id: 18,
    categoryId: 3,
    name: '肩颈舒缓护理',
    price: 49900,
    originalPrice: 68800,
    image: null,
    descriptionTitle: null,
    description: '服务说明',
    stock: 10,
    durationMinutes: 60,
    personCount: 1,
    validDays: null,
    type: 'service',
    showGroupBuyTag: true,
    isActive: true,
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
    updatedAt: maxUpdatedAt,
    category: { name: '面部护理' },
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    // 默认「未被预取」；需要覆盖预取语义的用例自行改写实现
    redisReadPrefetch.peekJson.mockResolvedValue(undefined);
    cacheStore = new Map();
    redisService.getJson.mockImplementation(
      (key: string): Promise<unknown> =>
        Promise.resolve(cacheStore.get(key) ?? null),
    );
    redisService.setJson.mockImplementation(
      (key: string, value: unknown): Promise<void> => {
        cacheStore.set(key, value);
        return Promise.resolve();
      },
    );
    prismaService.marketingProduct.aggregate.mockResolvedValue({
      _count: 3,
      _max: { updatedAt: maxUpdatedAt },
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClubProductCacheService,
        { provide: PrismaService, useValue: prismaService },
        { provide: RedisService, useValue: redisService },
        { provide: RedisReadPrefetchService, useValue: redisReadPrefetch },
      ],
    }).compile();
    service = module.get(ClubProductCacheService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('商品记录经缓存往返后时间戳仍还原为 Date，其余字段不失真', async () => {
    const record = buildRecord();
    const cacheKey = await service.buildListCacheKey({ storeId: 11, take: 6 });
    await service.writeList(cacheKey, [record]);

    const restored = await service.readList(cacheKey);

    expect(restored).toHaveLength(1);
    expect(restored?.[0].createdAt).toBeInstanceOf(Date);
    expect(restored?.[0].updatedAt).toBeInstanceOf(Date);
    expect(restored?.[0]).toEqual(record);
  });

  it('版本缓存命中时不再回源聚合', async () => {
    cacheStore.set(versionKey, 'cached-version');

    const cacheKey = await service.buildListCacheKey({ storeId: 11 });

    expect(cacheKey).toContain('v:cached-version');
    expect(prismaService.marketingProduct.aggregate).not.toHaveBeenCalled();
  });

  it('预取命中商品版本时不再单条 GET，也不再回源聚合', async () => {
    redisReadPrefetch.peekJson.mockImplementation((key: string) =>
      Promise.resolve(key === versionKey ? 'prefetched-version' : undefined),
    );

    const cacheKey = await service.buildListCacheKey({ storeId: 11, take: 6 });

    expect(cacheKey).toContain('v:prefetched-version');
    expect(redisService.getJson).not.toHaveBeenCalled();
    expect(prismaService.marketingProduct.aggregate).not.toHaveBeenCalled();
    // 列表 key 内嵌版本，无法预取：仍走单条 GET 回源
    expect(await service.readList(cacheKey)).toBeNull();
    expect(redisService.getJson).toHaveBeenCalledWith(cacheKey);
  });

  it('商品数量或最大更新时间变化会切换版本，旧列表 key 自然失效', async () => {
    const first = await service.buildListCacheKey({ storeId: 11, take: 6 });

    cacheStore.delete(versionKey);
    prismaService.marketingProduct.aggregate.mockResolvedValue({
      _count: 4,
      _max: { updatedAt: maxUpdatedAt },
    });
    const second = await service.buildListCacheKey({ storeId: 11, take: 6 });

    expect(second).not.toBe(first);
    expect(second).toContain('cat:0:cursor:0:take:6');
  });

  it('列表与版本使用不同 TTL', async () => {
    const cacheKey = await service.buildListCacheKey({ storeId: 11, take: 6 });
    await service.writeList(cacheKey, []);

    expect(redisService.setJson).toHaveBeenCalledWith(
      versionKey,
      expect.any(String),
      10,
    );
    expect(redisService.setJson).toHaveBeenCalledWith(cacheKey, [], 30);
  });

  it('详情缓存与列表缓存 key 隔离', async () => {
    const listKey = await service.buildListCacheKey({ storeId: 11, take: 6 });
    const detailKey = await service.buildDetailCacheKey(11, 18);

    await service.writeDetailHit(detailKey, buildRecord());

    expect(detailKey).not.toBe(listKey);
    expect(detailKey).toContain(':detail:18');
    expect(await service.readDetailEntry(detailKey)).toEqual(buildRecord());
    // 未写入的 key 必须返回 undefined（未命中），不能被误判成负缓存
    expect(await service.readDetailEntry(listKey)).toBeUndefined();
    expect(await service.readList(listKey)).toBeNull();
  });

  it('商品不存在的负缓存：读返回 null（区别于未命中），TTL 短于正向缓存', async () => {
    const detailKey = await service.buildDetailCacheKey(11, 404);

    await service.writeDetailAbsent(detailKey);

    // null = 确认不存在；query service 据此跳过回源
    expect(await service.readDetailEntry(detailKey)).toBeNull();
    expect(redisService.setJson).toHaveBeenCalledWith(
      detailKey,
      { found: false },
      5,
    );
  });

  it('Redis 读异常时降级回源，缓存不成为唯一数据源', async () => {
    redisService.getJson.mockRejectedValue(new Error('Redis 不可用'));

    const cacheKey = await service.buildListCacheKey({ storeId: 11, take: 6 });

    expect(cacheKey).toContain('club:products:store:11:v:');
    expect(await service.readList(cacheKey)).toBeNull();
    expect(prismaService.marketingProduct.aggregate).toHaveBeenCalledTimes(1);
  });

  it('首单资格缓存：未命中返回 null，写入后按布尔值命中', async () => {
    expect(await service.readConsumptionExists(11, 8001)).toBeNull();

    await service.writeConsumptionExists(11, 8001, false);
    expect(await service.readConsumptionExists(11, 8001)).toBe(false);

    await service.writeConsumptionExists(11, 8001, true);
    expect(await service.readConsumptionExists(11, 8001)).toBe(true);
  });

  it('首单资格缓存 key 按门店 + 顾客隔离，TTL 短于商品列表', async () => {
    await service.writeConsumptionExists(11, 8001, true);
    await service.writeConsumptionExists(11, 8002, true);
    await service.writeConsumptionExists(12, 8001, true);

    const keys = redisService.setJson.mock.calls.map(([key]) => key);
    expect(new Set(keys).size).toBe(3);
    expect(keys[0]).toBe('club:consumption-exists:store:11:customer:8001');
    expect(redisService.setJson).toHaveBeenCalledWith(keys[0], '1', 60);
  });

  it('首单资格缓存读异常降级为未命中（调用方回源 DB）', async () => {
    redisService.getJson.mockRejectedValue(new Error('Redis 不可用'));

    expect(await service.readConsumptionExists(11, 8001)).toBeNull();
  });
});
