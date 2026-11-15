import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';
import {
  buildClubPromotionsCacheKey,
  buildClubPromotionListCacheKey,
} from '../src/redis/keys/club-cache-keys';
import { ClubPromotionRepository } from '../src/purely-club/shared/club-promotion.repository';
import { ClubPromotionsService } from '../src/purely-club/promotions/club-promotions.service';

/**
 * 真实数据库 + 真实 Redis E2E：活动缓存的边界语义（3-B-1）。
 *
 * 三条要证明的事，只有跑真环境才能证明：
 * 1. 缓存的 TTL 被「最近的活动边界」截断，**不越过边界**；
 * 2. 到点之后（Redis 自然过期，不手动删 key）再查，已结束活动不再出现、
 *    已开始活动会出现 —— 这直接对应「到点即失效 / 即生效」；
 * 3. 无活动门店的空结果仍被缓存，且二次请求不回源。
 *
 * 不伪造时钟：Redis 的 EX 由服务端时钟决定，伪造 JS 时间只会让断言失真。
 * 这里用 2 秒级别的真实时间窗 + 真实 sleep，代价可接受（全局超时已放宽）。
 */
describe('C 端活动缓存边界语义 (e2e, real database + real redis)', () => {
  jest.setTimeout(30_000);

  const envConfig = new ConfigService();

  const configService = {
    get: (key: string): unknown => {
      switch (key) {
        case 'database.url':
          return envConfig.get<string>('DATABASE_URL');
        case 'database.poolMax':
          return 10;
        case 'database.poolMin':
          return 1;
        case 'database.poolIdleTimeoutMs':
          return 30_000;
        case 'database.poolConnectionTimeoutMs':
          return 5_000;
        case 'database.statementTimeoutMs':
          return 10_000;
        case 'database.pgMaxConnections':
          return 100;
        case 'app.slowQueryLogEnabled':
          return false;
        case 'app.slowQueryThresholdMs':
          return 80;
        case 'app.sqlMetricsEnabled':
          return false;
        case 'app.slowRedisLogEnabled':
          return false;
        case 'app.slowRedisThresholdMs':
          return 20;
        case 'redis.host':
          return envConfig.get<string>('REDIS_HOST') ?? 'localhost';
        case 'redis.port':
          return Number(envConfig.get<string>('REDIS_PORT') ?? 6379);
        case 'redis.password':
          return envConfig.get<string>('REDIS_PASSWORD') ?? '';
        case 'redis.db':
          return Number(envConfig.get<string>('REDIS_DB') ?? 0);
        case 'redis.connectTimeoutMs':
          return 5_000;
        case 'redis.commandTimeoutMs':
          return 3_000;
        case 'redis.maxRetriesPerRequest':
          return 3;
        case 'nodeEnv':
          return 'test';
        default:
          return undefined;
      }
    },
  } as ConfigService;

  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    });

  let prisma: PrismaService;
  let redis: RedisService;
  let moduleFixture: TestingModule;
  let repository: ClubPromotionRepository;
  let promotionsService: ClubPromotionsService;

  const createdStoreIds: number[] = [];
  const createdOwnerIds: number[] = [];
  const createdPromotionIds: number[] = [];

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const createStore = async (tag: string): Promise<number> => {
    // store.owner_id 唯一：每个门店都要配一个新 owner
    const owner = await prisma.user.create({
      data: { email: `e2e-promo-${tag}-${suffix}@test.local`, password: 'x' },
    });
    createdOwnerIds.push(owner.id);
    const store = await prisma.store.create({
      data: {
        name: `E2E活动缓存${tag}-${suffix}`,
        ownerId: owner.id,
        businessMode: 'general',
      },
    });
    createdStoreIds.push(store.id);
    return store.id;
  };

  const createPromotion = async (params: {
    storeId: number;
    startAt: Date;
    endAt: Date;
  }): Promise<number> => {
    const promotion = await prisma.marketingPromotion.create({
      data: {
        storeId: params.storeId,
        name: 'E2E 折扣活动',
        type: 'discount',
        description: '',
        params: { discountRate: 90 },
        startAt: params.startAt,
        endAt: params.endAt,
        enabled: true,
      },
      select: { id: true },
    });
    createdPromotionIds.push(promotion.id);
    return promotion.id;
  };

  const ttlOf = async (key: string): Promise<number> =>
    redis.getClient().ttl(key);

  beforeAll(async () => {
    if (!configService.get('database.url')) {
      throw new Error('缺少 DATABASE_URL，无法运行真实数据库 E2E');
    }

    moduleFixture = await Test.createTestingModule({
      providers: [
        { provide: ConfigService, useValue: configService },
        PrismaService,
        RedisService,
        ClubPromotionRepository,
        ClubPromotionsService,
      ],
    }).compile();
    // 触发 RedisService.onModuleInit / onApplicationBootstrap（建连 + ping）
    await moduleFixture.init();

    prisma = moduleFixture.get(PrismaService);
    redis = moduleFixture.get(RedisService);
    repository = moduleFixture.get(ClubPromotionRepository);
    promotionsService = moduleFixture.get(ClubPromotionsService);
  });

  afterAll(async () => {
    if (prisma) {
      for (const storeId of createdStoreIds) {
        await redis.del(buildClubPromotionsCacheKey(storeId));
        await redis.del(buildClubPromotionListCacheKey(storeId));
      }
      if (createdPromotionIds.length > 0) {
        await prisma.marketingPromotion.deleteMany({
          where: { id: { in: createdPromotionIds } },
        });
      }
      if (createdStoreIds.length > 0) {
        await prisma.store.deleteMany({
          where: { id: { in: createdStoreIds } },
        });
      }
      if (createdOwnerIds.length > 0) {
        await prisma.user.deleteMany({
          where: { id: { in: createdOwnerIds } },
        });
      }
      await prisma.$disconnect();
    }
    await moduleFixture.close();
  });

  it('结束边界：活动到点后不再返回，且缓存不会活过边界', async () => {
    const storeId = await createStore('ending');
    const now = Date.now();
    await createPromotion({
      storeId,
      startAt: new Date(now - 3_600_000),
      endAt: new Date(now + 2_000),
    });

    const before = await repository.loadActivePromotions(storeId);
    expect(before).toHaveLength(1);
    const ttl = await ttlOf(buildClubPromotionsCacheKey(storeId));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(2);

    // 不手动删 key：等 Redis 自然过期 + 时间越过 endAt
    await sleep(2_600);

    const after = await repository.loadActivePromotions(storeId);
    expect(after).toEqual([]);
  });

  it('开始边界：活动到点后立刻出现，缓存不会活过开始时间', async () => {
    const storeId = await createStore('starting');
    const now = Date.now();
    await createPromotion({
      storeId,
      startAt: new Date(now + 2_000),
      endAt: new Date(now + 3_600_000),
    });

    // 未开始：结果为空，但 TTL 必须被开始时间截断
    const before = await repository.loadActivePromotions(storeId);
    expect(before).toEqual([]);
    const ttl = await ttlOf(buildClubPromotionsCacheKey(storeId));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(2);

    await sleep(2_600);

    const after = await repository.loadActivePromotions(storeId);
    expect(after).toHaveLength(1);
    expect(after[0]).toEqual(
      expect.objectContaining({ type: 'discount', name: 'E2E 折扣活动' }),
    );
  });

  it('无活动门店：空结果仍被缓存，二次请求不回源', async () => {
    const storeId = await createStore('empty');

    await expect(repository.loadActivePromotions(storeId)).resolves.toEqual([]);
    expect(await ttlOf(buildClubPromotionsCacheKey(storeId))).toBe(60);

    const findMany = jest.spyOn(prisma.marketingPromotion, 'findMany');
    await expect(repository.loadActivePromotions(storeId)).resolves.toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
    findMany.mockRestore();
  });

  it('展示列表同样按边界截断，且与定价缓存是两个独立 key', async () => {
    const storeId = await createStore('display');
    const now = Date.now();
    await createPromotion({
      storeId,
      startAt: new Date(now + 30_000),
      endAt: new Date(now + 3_600_000),
    });

    const result = await promotionsService.list({
      store: { id: storeId },
    } as never);

    // 未开始的展示同样不可见（与定价口径一致）
    expect(result.items).toEqual([]);
    expect(await ttlOf(buildClubPromotionListCacheKey(storeId))).toBe(30);
    expect(buildClubPromotionListCacheKey(storeId)).not.toBe(
      buildClubPromotionsCacheKey(storeId),
    );
  });
});
