import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
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

    await service.writeDetail(detailKey, buildRecord());

    expect(detailKey).not.toBe(listKey);
    expect(detailKey).toContain(':detail:18');
    expect(await service.readDetail(detailKey)).toEqual(buildRecord());
    expect(await service.readList(listKey)).toBeNull();
  });

  it('Redis 读异常时降级回源，缓存不成为唯一数据源', async () => {
    redisService.getJson.mockRejectedValue(new Error('Redis 不可用'));

    const cacheKey = await service.buildListCacheKey({ storeId: 11, take: 6 });

    expect(cacheKey).toContain('club:products:store:11:v:');
    expect(await service.readList(cacheKey)).toBeNull();
    expect(prismaService.marketingProduct.aggregate).toHaveBeenCalledTimes(1);
  });
});
