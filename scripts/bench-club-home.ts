/**
 * purelyClub 首页链路 + JWT 鉴权链路性能基准（离线、无外部依赖）。
 *
 * 目的：在「不连真实 Redis / PostgreSQL」的前提下，量化首页相关接口与鉴权链路的
 *        IO 往返次数与端到端耗时，用于对比优化前后差异。
 *
 * 方法：
 *  - FakeRedis / FakePrisma 记录每次命令/查询，并注入固定延迟
 *    （Redis RTT 默认 2ms、PG 单次查询默认 5ms），真实反映「并行度」——
 *    并发发出的调用会重叠等待，串行调用会累加，因此测出的耗时等价于
 *    「依赖链最深处跳数 × 每跳延迟」；pipeline 内的多条命令只算 1 次往返。
 *  - 每个场景重复采样取中位数，抵消计时器抖动与 JIT 影响。
 *  - 鉴权链路同时跑「合并前（4 分支各自读 Redis）」与「合并后（1 pipeline + 1 MGET）」
 *    两条真实实现，口径完全一致。
 *
 * 运行：pnpm exec ts-node --transpile-only scripts/bench-club-home.ts
 * 参数：--redis-rtt=2 --db-query=5（毫秒，缺省即上面标注的默认值）
 */

import { ClubCheckInCacheService } from '../src/purely-club/check-in/club-check-in.cache.service';
import { ClubCheckInQueryService } from '../src/purely-club/check-in/club-check-in.query.service';
import { ClubCheckInService } from '../src/purely-club/check-in/club-check-in.service';
import { ClubCheckInStatusService } from '../src/purely-club/check-in/club-check-in.status.service';
import { ClubHomeService } from '../src/purely-club/home/club-home.service';
import { ClubMemberProfileService } from '../src/purely-club/member/member-profile/club-member-profile.service';
import { ClubMemberLevelsService } from '../src/purely-club/member/member-levels/club-member-levels.service';
import { ClubMemberService } from '../src/purely-club/member/club-member.service';
import { ClubPointsQueryService } from '../src/purely-club/points/club-points-query.service';
import { ClubProductCacheService } from '../src/purely-club/products/club-product-cache.service';
import { ClubProductPromotionService } from '../src/purely-club/products/club-product-promotion.service';
import { ClubProductQueryService } from '../src/purely-club/products/club-product-query.service';
import { ClubProductViewService } from '../src/purely-club/products/club-product-view.service';
import { ClubProductsService } from '../src/purely-club/products/club-products.service';
import { ClubPromotionsService } from '../src/purely-club/promotions/club-promotions.service';
import { ClubPromotionRepository } from '../src/purely-club/shared/club-promotion.repository';
import { RedisReadPrefetchService } from '../src/redis/redis-read-prefetch.service';
import { ClubStoreViewService } from '../src/purely-club/stores/club-store-view.service';
import { ClubStoresService } from '../src/purely-club/stores/club-stores.service';
import type { ClubCurrentContext } from '../src/purely-club/stores/club-stores.types';
import { StoresProfileService } from '../src/purely-profit/stores/stores-profile.service';
import { AuthBanGuardService } from '../src/purely-profit/auth/auth-ban-guard.service';
import { AuthSessionService } from '../src/purely-profit/auth/auth-session.service';
import { AuthUserCacheService } from '../src/purely-profit/auth/auth-user-cache.service';
import type { ResolvedAuthUserRecord } from '../src/purely-profit/auth/auth-user-cache.service';
import { AuthValidateContextService } from '../src/purely-profit/auth/auth-validate-context.service';
import {
  buildTokenVersionKey,
  buildUserCacheKey,
  buildUserRelatedStoreIdsCacheKey,
} from '../src/purely-profit/auth/auth.utils';

/** 读取 `--name=value` 形式的命令行参数；缺省或非法时用默认值 */
const readArgNumber = (name: string, fallback: number): number => {
  const prefix = `--${name}=`;
  const matched = process.argv.find((arg) => arg.startsWith(prefix));
  if (!matched) return fallback;
  const parsed = Number(matched.slice(prefix.length));
  return Number.isFinite(parsed) ? parsed : fallback;
};

/** 模拟延迟（毫秒）：贴近同可用区 Redis / PG 的典型 RTT */
const REDIS_RTT_MS = readArgNumber('redis-rtt', 2);
const DB_QUERY_MS = readArgNumber('db-query', 5);
/** 每个场景采样次数 */
const SAMPLES = 9;
/** 单个场景内的首页并发请求数（小程序首页真实并发：home + 签到状态等） */
const HOME_CONCURRENT_REQUESTS = 2;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

interface IoCounters {
  /** Redis 命令条数：pipeline 里的每条命令都要算 */
  redisCommands: number;
  /** Redis 网络往返次数：一次 pipeline 只算 1 次往返，这正是合并后的收益来源 */
  redisRoundTrips: number;
  dbQueries: number;
}

const counters: IoCounters = {
  redisCommands: 0,
  redisRoundTrips: 0,
  dbQueries: 0,
};

const resetCounters = (): void => {
  counters.redisCommands = 0;
  counters.redisRoundTrips = 0;
  counters.dbQueries = 0;
};

/** 只读 pipeline 的最小接口（与 ioredis ChainableCommander 的同名子集一致） */
interface AuthReadPipeline {
  get: (key: string) => AuthReadPipeline;
  mget: (...keys: string[]) => AuthReadPipeline;
  zscore: (key: string, member: string) => AuthReadPipeline;
}

interface ReadPipelineReply {
  ok: boolean;
  replies: (string | number | null | (string | null)[])[];
}

/** 内存版 Redis：支持 TTL、MGET、ZSCORE、JSON 读写与只读 pipeline */
class FakeRedis {
  private readonly store = new Map<string, string>();
  private readonly expiresAt = new Map<string, number>();
  private readonly zsets = new Map<string, Set<string>>();

  async get(key: string): Promise<string | null> {
    counters.redisCommands += 1;
    counters.redisRoundTrips += 1;
    await sleep(REDIS_RTT_MS);
    return this.read(key);
  }

  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.get(key);
    return raw === null ? null : (JSON.parse(raw) as T);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    counters.redisCommands += 1;
    counters.redisRoundTrips += 1;
    await sleep(REDIS_RTT_MS);
    this.write(key, value, ttlSeconds);
  }

  async setJson(
    key: string,
    value: unknown,
    ttlSeconds?: number,
  ): Promise<void> {
    await this.set(key, JSON.stringify(value), ttlSeconds);
  }

  async mget(keys: string[]): Promise<(string | null)[]> {
    if (keys.length === 0) return [];
    counters.redisCommands += 1;
    counters.redisRoundTrips += 1;
    await sleep(REDIS_RTT_MS);
    return keys.map((key) => this.read(key));
  }

  async mgetJson<T>(keys: string[]): Promise<(T | null)[]> {
    const raws = await this.mget(keys);
    return raws.map((raw) => (raw === null ? null : (JSON.parse(raw) as T)));
  }

  async del(key: string): Promise<void> {
    counters.redisCommands += 1;
    counters.redisRoundTrips += 1;
    await sleep(REDIS_RTT_MS);
    this.store.delete(key);
    this.expiresAt.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    counters.redisCommands += 1;
    counters.redisRoundTrips += 1;
    await sleep(REDIS_RTT_MS);
    return this.read(key) !== null;
  }

  async setIfAbsent(
    key: string,
    value: string,
    ttlSeconds: number,
  ): Promise<boolean> {
    counters.redisCommands += 1;
    counters.redisRoundTrips += 1;
    await sleep(REDIS_RTT_MS);
    if (this.read(key) !== null) return false;
    this.write(key, value, ttlSeconds);
    return true;
  }

  async zscore(key: string, member: string): Promise<string | null> {
    counters.redisCommands += 1;
    counters.redisRoundTrips += 1;
    await sleep(REDIS_RTT_MS);
    return this.readZScore(key, member);
  }

  /**
   * 一次往返执行多条只读命令。
   * 命令条数按真实条数累计，往返只记 1 次——这正是 pipeline 与
   * 「逐条独立读取」在真实网络下的差异。
   */
  async executeReadPipeline(
    build: (pipeline: AuthReadPipeline) => void,
  ): Promise<ReadPipelineReply> {
    const operations: (() => string | number | null | (string | null)[])[] = [];
    const pipeline: AuthReadPipeline = {
      get: (key: string): AuthReadPipeline => {
        operations.push(() => this.read(key));
        return pipeline;
      },
      mget: (...keys: string[]): AuthReadPipeline => {
        operations.push(() => keys.map((key) => this.read(key)));
        return pipeline;
      },
      zscore: (key: string, member: string): AuthReadPipeline => {
        operations.push(() => this.readZScore(key, member));
        return pipeline;
      },
    };

    build(pipeline);
    counters.redisCommands += operations.length;
    counters.redisRoundTrips += 1;
    await sleep(REDIS_RTT_MS);
    return { ok: true, replies: operations.map((operation) => operation()) };
  }

  seedString(key: string, value: string): void {
    this.write(key, value);
  }

  seedJson(key: string, value: unknown): void {
    this.write(key, JSON.stringify(value));
  }

  seedSession(key: string, sessionId: string): void {
    const members = this.zsets.get(key) ?? new Set<string>();
    members.add(sessionId);
    this.zsets.set(key, members);
  }

  private readZScore(key: string, member: string): string | null {
    return this.zsets.get(key)?.has(member) === true ? '1750000000000' : null;
  }

  private read(key: string): string | null {
    const expireAt = this.expiresAt.get(key);
    if (expireAt !== undefined && Date.now() >= expireAt) {
      this.store.delete(key);
      this.expiresAt.delete(key);
      return null;
    }
    return this.store.get(key) ?? null;
  }

  private write(key: string, value: string, ttlSeconds?: number): void {
    this.store.set(key, value);
    if (ttlSeconds) {
      this.expiresAt.set(key, Date.now() + ttlSeconds * 1000);
    } else {
      this.expiresAt.delete(key);
    }
  }
}

/** 固定延迟 + 计数的 Prisma 替身，返回与真实查询同形的数据 */
class FakePrisma {
  private readonly now = Date.now();

  private async tap<T>(result: T): Promise<T> {
    counters.dbQueries += 1;
    await sleep(DB_QUERY_MS);
    return result;
  }

  readonly store = {
    findUnique: async (): Promise<unknown> =>
      this.tap({
        profileMetadata: {
          storeLogo: 'https://cdn.example.com/logo.png',
          latitude: 39.9,
          longitude: 116.4,
        },
      }),
    findMany: async (): Promise<unknown[]> => this.tap([]),
  };

  readonly marketingMemberLevelSetting = {
    // 返回 null → 走默认等级配置，避免基准依赖 schema 细节
    findUnique: async (): Promise<unknown> => this.tap(null),
  };

  readonly member = {
    findFirst: async (): Promise<unknown> =>
      this.tap({
        id: 9001,
        createdAt: new Date(this.now - 200 * 86400000),
      }),
  };

  readonly marketingCustomer = {
    findFirst: async (): Promise<unknown> =>
      this.tap({
        id: 8001,
        balance: 35000,
        points: 1280,
        tier: 'gold',
        memberId: 9001,
        clubUserId: 201,
        createdAt: new Date(this.now - 210 * 86400000),
      }),
  };

  readonly marketingRecharge = {
    aggregate: async (): Promise<unknown> =>
      this.tap({ _sum: { amount: 320000 } }),
  };

  readonly marketingConsumption = {
    findFirst: async (): Promise<unknown> => this.tap(null),
  };

  readonly marketingProduct = {
    findMany: async (): Promise<unknown[]> => this.tap(this.buildProducts()),
    aggregate: async (): Promise<unknown> =>
      this.tap({
        _count: 6,
        _max: { updatedAt: new Date(this.now) },
      }),
  };

  readonly marketingPromotion = {
    findMany: async (): Promise<unknown[]> => this.tap(this.buildPromotions()),
    findFirst: async (): Promise<unknown> =>
      this.tap({
        id: 77,
        enabled: true,
        startAt: new Date(this.now - 10 * 86400000),
        endAt: new Date(this.now + 10 * 86400000),
        params: { pointsPerCheckIn: 5 },
      }),
  };

  readonly clubDailyCheckInRecord = {
    findMany: async (): Promise<unknown[]> => this.tap([]),
  };

  readonly marketingPointsRecord = {
    aggregate: async (): Promise<unknown> => this.tap({ _sum: { amount: 0 } }),
    findMany: async (): Promise<unknown[]> => this.tap([]),
  };

  private buildProducts(): unknown[] {
    return Array.from({ length: 6 }, (_, index) => ({
      id: 31 + index,
      categoryId: 1,
      name: `养护套餐 ${index + 1}`,
      price: 19900,
      originalPrice: 28800,
      image: null,
      descriptionTitle: '经典养护',
      description: '深层清洁 + 补水保湿',
      stock: 10,
      durationMinutes: 60,
      personCount: 1,
      validDays: 30,
      type: 'service',
      showGroupBuyTag: true,
      isActive: true,
      createdAt: new Date(this.now - 30 * 86400000),
      updatedAt: new Date(this.now),
      category: { name: '养护' },
    }));
  }

  private buildPromotions(): unknown[] {
    return [
      {
        id: 8,
        name: '首单 8 折',
        type: 'first_order_discount',
        description: '首次下单专享',
        params: { discountRate: 80 },
        startAt: new Date(this.now - 5 * 86400000),
        endAt: new Date(this.now + 25 * 86400000),
        createdAt: new Date(this.now - 5 * 86400000),
        bannerImage: null,
        enabled: true,
      },
      {
        id: 9,
        name: '满 300 减 30',
        type: 'reduce',
        description: '消费满额立减',
        params: { threshold: 30000, reduceAmount: 3000 },
        startAt: new Date(this.now - 5 * 86400000),
        endAt: new Date(this.now + 25 * 86400000),
        createdAt: new Date(this.now - 5 * 86400000),
        bannerImage: null,
        enabled: true,
      },
    ];
  }
}

const currentContext: ClubCurrentContext = {
  user: {
    id: 201,
    email: 'club_phone_13800138000@purelyprofit.local',
    phone: '13800138000',
    name: '俱乐部用户',
    createdAt: new Date('2026-05-12T00:00:00.000Z'),
    updatedAt: new Date('2026-05-13T00:00:00.000Z'),
    lastActiveAt: null,
    accountScope: 'purely_club',
    currentMembership: null,
  },
  store: {
    id: 11,
    name: '望京旗舰店',
    address: '北京市朝阳区望京 SOHO T3 B1',
    businessMode: 'general',
    memberCareEnabled: false,
    createdAt: new Date('2026-05-12T00:00:00.000Z'),
    updatedAt: new Date('2026-05-13T00:00:00.000Z'),
  },
};

/** 依赖树：全部使用真实 service 实现，仅基础设施层被替身替换 */
const createStack = (): {
  homeService: ClubHomeService;
  checkInService: ClubCheckInService;
} => {
  const redis = new FakeRedis();
  const prisma = new FakePrisma();

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const redisAny = redis as any;
  const prismaAny = prisma as any;

  // 预取容器：与生产链路一致，由 ClubHomeService 在每次聚合入口开启作用域
  const redisReadPrefetch = new RedisReadPrefetchService(redisAny);

  const storesProfileService = new StoresProfileService(
    prismaAny,
    redisAny,
    redisReadPrefetch,
  );
  const storeViewService = new ClubStoreViewService(storesProfileService);
  const clubStoresService = new ClubStoresService(
    {} as any,
    {} as any,
    storeViewService,
    {} as any,
  );

  const memberProfileService = new ClubMemberProfileService(
    prismaAny,
    redisAny,
    redisReadPrefetch,
  );
  const memberLevelsService = new ClubMemberLevelsService(prismaAny);
  const clubMemberService = new ClubMemberService(
    {} as any,
    memberProfileService,
    memberLevelsService,
    {} as any,
    {} as any,
    prismaAny,
  );

  const clubPromotionsService = new ClubPromotionsService(
    prismaAny,
    redisAny,
    redisReadPrefetch,
  );

  const productCacheService = new ClubProductCacheService(
    prismaAny,
    redisAny,
    redisReadPrefetch,
  );
  const productQueryService = new ClubProductQueryService(
    prismaAny,
    productCacheService,
  );
  const promotionRepository = new ClubPromotionRepository(
    prismaAny,
    redisAny,
    redisReadPrefetch,
  );
  const productPromotionService = new ClubProductPromotionService(
    prismaAny,
    memberProfileService,
    memberLevelsService,
    promotionRepository,
    productCacheService,
  );
  const clubProductsService = new ClubProductsService(
    productQueryService,
    productPromotionService,
    new ClubProductViewService(),
  );

  const homeService = new ClubHomeService(
    clubStoresService,
    clubMemberService,
    clubPromotionsService,
    clubProductsService,
    redisReadPrefetch,
  );

  const checkInCacheService = new ClubCheckInCacheService(redisAny);
  const checkInQueryService = new ClubCheckInQueryService(
    prismaAny,
    new ClubPointsQueryService(prismaAny),
    checkInCacheService,
  );
  const checkInService = new ClubCheckInService(
    prismaAny,
    redisAny,
    {} as any,
    checkInQueryService,
    checkInCacheService,
    new ClubCheckInStatusService(checkInQueryService, checkInCacheService),
  );
  /* eslint-enable @typescript-eslint/no-explicit-any */

  return { homeService, checkInService };
};

interface ScenarioResult {
  label: string;
  redisCommands: number;
  redisRoundTrips: number;
  dbQueries: number;
  medianMs: number;
}

type Measure<T> = (
  label: string,
  create: () => T,
  run: (stack: T) => Promise<void>,
) => Promise<ScenarioResult>;

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

/** 冷启动场景：每次采样都重建依赖树与空缓存 */
const measureCold = async <T>(
  label: string,
  create: () => T,
  run: (stack: T) => Promise<void>,
): Promise<ScenarioResult> => {
  const timings: number[] = [];
  let redisCommands = 0;
  let redisRoundTrips = 0;
  let dbQueries = 0;

  for (let i = 0; i < SAMPLES; i += 1) {
    const stack = create();
    resetCounters();
    const startedAt = performance.now();
    await run(stack);
    timings.push(performance.now() - startedAt);
    redisCommands = counters.redisCommands;
    redisRoundTrips = counters.redisRoundTrips;
    dbQueries = counters.dbQueries;
  }

  return {
    label,
    redisCommands,
    redisRoundTrips,
    dbQueries,
    medianMs: median(timings),
  };
};

/** 热缓存场景：同一依赖树先预热一次，再连续采样 */
const measureWarm = async <T>(
  label: string,
  create: () => T,
  run: (stack: T) => Promise<void>,
): Promise<ScenarioResult> => {
  const stack = create();
  await run(stack);

  const timings: number[] = [];
  resetCounters();
  for (let i = 0; i < SAMPLES; i += 1) {
    const roundStartedAt = performance.now();
    await run(stack);
    timings.push(performance.now() - roundStartedAt);
  }

  return {
    label,
    redisCommands: Math.round(counters.redisCommands / SAMPLES),
    redisRoundTrips: Math.round(counters.redisRoundTrips / SAMPLES),
    dbQueries: Math.round(counters.dbQueries / SAMPLES),
    medianMs: median(timings),
  };
};

type HomeStack = ReturnType<typeof createStack>;

/** 首页一次进场：home 与签到状态并发发出 */
const runHomeEntry = async (stack: HomeStack): Promise<void> => {
  await Promise.all(
    Array.from({ length: HOME_CONCURRENT_REQUESTS }, async (_, index) => {
      if (index === 0) {
        await stack.homeService.getHome(currentContext);
        return;
      }
      await stack.checkInService.getStatus(currentContext);
    }),
  );
};

/**
 * 一次会话：首次进入（冷启动）+ 切 tab 返回若干次（热缓存）。
 *
 * 这是真实使用中最典型的访问形态——小程序一次停留里 didShow 会多次触发，
 * 缓存收益体现在第 2 次之后的每一次进入。
 */
const HOME_REENTRY_COUNT = 2;

const measureSession = async (
  label: string,
  create: () => HomeStack,
  run: (stack: HomeStack) => Promise<void>,
): Promise<ScenarioResult> => {
  const timings: number[] = [];
  let redisCommands = 0;
  let redisRoundTrips = 0;
  let dbQueries = 0;

  for (let i = 0; i < SAMPLES; i += 1) {
    const stack = create();
    resetCounters();
    const startedAt = performance.now();
    await run(stack); // 冷启动
    for (let round = 0; round < HOME_REENTRY_COUNT; round += 1) {
      await run(stack); // 切 tab 返回
    }
    timings.push(performance.now() - startedAt);
    redisCommands = counters.redisCommands;
    redisRoundTrips = counters.redisRoundTrips;
    dbQueries = counters.dbQueries;
  }

  return {
    label,
    redisCommands,
    redisRoundTrips,
    dbQueries,
    medianMs: median(timings),
  };
};

// ── 鉴权链路：合并前 vs 合并后 ───────────────────────────────

const AUTH_USER_ID = 201;
const AUTH_STORE_ID = 11;
const AUTH_SESSION_ID = 'bench-session';

const AUTH_USER_RECORD: ResolvedAuthUserRecord = {
  id: AUTH_USER_ID,
  email: 'club_phone_13800138000@purelyprofit.local',
  name: '会员',
  createdAt: new Date('2026-05-12T00:00:00.000Z'),
  updatedAt: new Date('2026-05-13T00:00:00.000Z'),
  lastActiveAt: null,
};

const AUTH_PAYLOAD = {
  sub: AUTH_USER_ID,
  phone: '13800138000',
  sessionVersion: 0,
  sid: AUTH_SESSION_ID,
  accountScope: 'purely_club',
} as const;

/** 固定延迟 + 计数的 Prisma 替身（鉴权链路只需要 user / store 两张表） */
class AuthFakePrisma {
  private async tap<T>(result: T): Promise<T> {
    counters.dbQueries += 1;
    await sleep(DB_QUERY_MS);
    return result;
  }

  readonly user = {
    findUnique: async (): Promise<ResolvedAuthUserRecord> =>
      this.tap(AUTH_USER_RECORD),
  };

  readonly store = {
    findMany: async (): Promise<{ id: number }[]> =>
      this.tap([{ id: AUTH_STORE_ID }]),
  };
}

interface AuthChainStack {
  /** 合并前：user / 版本 / 会话 / 封禁四个分支各自读 Redis，封禁再走一跳 */
  legacy: () => Promise<unknown>;
  /** 合并后：1 次 pipeline + 1 次封禁 MGET */
  merged: () => Promise<unknown>;
}

const createAuthChainStack = (warmCache = true): AuthChainStack => {
  const redis = new FakeRedis();
  const prisma = new AuthFakePrisma();

  // 稳态鉴权链路的常态：user 缓存 5 分钟、关联门店 5 分钟、会话 30 天
  if (warmCache) {
    redis.seedJson(buildUserCacheKey(AUTH_USER_ID), AUTH_USER_RECORD);
    redis.seedString(buildTokenVersionKey(AUTH_USER_ID), '0');
    redis.seedSession(
      AuthSessionService.buildSessionSetKey(AUTH_USER_ID),
      AUTH_SESSION_ID,
    );
    redis.seedJson(buildUserRelatedStoreIdsCacheKey(AUTH_USER_ID), [
      AUTH_STORE_ID,
    ]);
  }

  const sessionService = new AuthSessionService(
    redis as never,
    {} as never,
    { get: () => undefined } as never,
  );
  const userCacheService = new AuthUserCacheService(
    prisma as never,
    redis as never,
  );
  const banGuardService = new AuthBanGuardService(
    prisma as never,
    redis as never,
  );
  const validateContextService = new AuthValidateContextService(
    redis as never,
    userCacheService,
    sessionService,
    banGuardService,
  );

  return {
    // 合并前的 validate 主干：四个分支并行，但每条命令各一次网络往返
    legacy: async (): Promise<unknown> =>
      Promise.all([
        userCacheService.resolveUser(AUTH_USER_ID),
        sessionService.getTokenVersion(AUTH_USER_ID),
        sessionService.isSessionActive(AUTH_USER_ID, AUTH_SESSION_ID),
        banGuardService.ensureUserNotBanned(AUTH_USER_ID),
      ]),
    merged: (): Promise<unknown> => validateContextService.load(AUTH_PAYLOAD),
  };
};

interface AuthPair {
  label: string;
  before: ScenarioResult;
  after: ScenarioResult;
}

const formatDelta = (before: number, after: number): string => {
  if (before === 0) return '—';
  const delta = ((after - before) / before) * 100;
  return `${delta > 0 ? '+' : ''}${delta.toFixed(1)}%`;
};

const main = async (): Promise<void> => {
  const results: ScenarioResult[] = [];
  const authPairs: AuthPair[] = [];

  results.push(
    await measureSession(
      `一次会话（首次进入 + 切回 ${HOME_REENTRY_COUNT} 次）`,
      createStack,
      runHomeEntry,
    ),
  );
  results.push(
    await measureCold(
      '首页进场 · 冷缓存（Redis+PG 全 miss）',
      createStack,
      runHomeEntry,
    ),
  );
  results.push(
    await measureWarm(
      '首页进场 · 热缓存（短 TTL 内重复进入）',
      createStack,
      runHomeEntry,
    ),
  );
  results.push(
    await measureCold('GET /club/home · 冷缓存', createStack, async (stack) => {
      await stack.homeService.getHome(currentContext);
    }),
  );
  results.push(
    await measureWarm('GET /club/home · 热缓存', createStack, async (stack) => {
      await stack.homeService.getHome(currentContext);
    }),
  );
  results.push(
    await measureCold(
      'GET /club/check-in/status · 冷缓存',
      createStack,
      async (stack) => {
        await stack.checkInService.getStatus(currentContext);
      },
    ),
  );
  results.push(
    await measureWarm(
      'GET /club/check-in/status · 热缓存',
      createStack,
      async (stack) => {
        await stack.checkInService.getStatus(currentContext);
      },
    ),
  );

  /** 同一场景下对比「合并前 / 合并后」两条鉴权链路 */
  const measureAuthPair = async (
    label: string,
    create: () => AuthChainStack,
    measure: Measure<AuthChainStack>,
    concurrency: number,
  ): Promise<void> => {
    const runWith =
      (stage: 'legacy' | 'merged') =>
      async (stack: AuthChainStack): Promise<void> => {
        await Promise.all(
          Array.from({ length: concurrency }, async () => {
            await stack[stage]();
          }),
        );
      };

    const before = await measure(
      `${label} · 合并前`,
      create,
      runWith('legacy'),
    );
    const after = await measure(`${label} · 合并后`, create, runWith('merged'));

    authPairs.push({ label, before, after });
    results.push(before, after);
  };

  const warmAuthStack = (): AuthChainStack => createAuthChainStack(true);
  const coldAuthStack = (): AuthChainStack => createAuthChainStack(false);

  await measureAuthPair(
    '鉴权链路 · 单请求（热缓存）',
    warmAuthStack,
    measureWarm,
    1,
  );
  await measureAuthPair(
    `鉴权链路 · 首页 ${HOME_CONCURRENT_REQUESTS} 并发（热缓存）`,
    warmAuthStack,
    measureWarm,
    HOME_CONCURRENT_REQUESTS,
  );
  await measureAuthPair(
    `鉴权链路 · 首页 ${HOME_CONCURRENT_REQUESTS} 并发（冷缓存）`,
    coldAuthStack,
    measureCold,
    HOME_CONCURRENT_REQUESTS,
  );

  console.log(
    `\n模拟延迟：Redis RTT ${REDIS_RTT_MS}ms / PG 单次查询 ${DB_QUERY_MS}ms，每场景 ${SAMPLES} 次采样取中位数`,
  );
  console.log(
    '计数口径：Redis 命令数 = 实际发出的命令条数（pipeline 内每条都算）；Redis 往返次数 = 网络交互次数（一次 pipeline 只算 1 次）\n',
  );
  console.table(
    results.map((result) => ({
      场景: result.label,
      'Redis 命令数': result.redisCommands,
      'Redis 往返次数': result.redisRoundTrips,
      'PG 查询数': result.dbQueries,
      '中位耗时(ms)': Number(result.medianMs.toFixed(2)),
    })),
  );

  console.log(
    '\n鉴权链路合并前后对比（百分比为「合并后相对合并前」的变化）：\n',
  );
  console.table(
    authPairs.map(({ label, before, after }) => ({
      场景: label,
      '往返次数(前→后)': `${before.redisRoundTrips} → ${after.redisRoundTrips}（${formatDelta(before.redisRoundTrips, after.redisRoundTrips)}）`,
      '命令数(前→后)': `${before.redisCommands} → ${after.redisCommands}（${formatDelta(before.redisCommands, after.redisCommands)}）`,
      '中位耗时(前→后, ms)': `${before.medianMs.toFixed(2)} → ${after.medianMs.toFixed(2)}（${formatDelta(before.medianMs, after.medianMs)}）`,
    })),
  );
};

void main();
