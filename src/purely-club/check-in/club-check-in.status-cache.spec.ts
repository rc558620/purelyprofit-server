import type { RedisService } from '../../redis/redis.service';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import { ClubCheckInCacheService } from './club-check-in.cache.service';
import { ClubCheckInQueryService } from './club-check-in.query.service';
import { ClubCheckInService } from './club-check-in.service';
import { ClubCheckInStatusService } from './club-check-in.status.service';

/**
 * 签到状态缓存的端到端行为：
 * 首页 Hero 每次进场都会请求 `/club/check-in/status`，缓存命中后
 * 必须做到「零 DB 查询」，且失效后能立刻回源。
 */

const NOW = new Date('2026-11-06T08:00:00.000Z');
const START_AT = new Date('2026-11-01T00:00:00.000Z');
const END_AT = new Date('2026-12-01T00:00:00.000Z');

/** 带内存 Map 的最小 Redis 替身，语义与 RedisService 的 getJson/setJson/del 对齐 */
const createMemoryRedis = () => {
  const store = new Map<string, string>();
  const readOne = (key: string): unknown => {
    const raw = store.get(key);
    return raw === undefined ? null : JSON.parse(raw);
  };

  return {
    getJson: jest.fn((key: string) => Promise.resolve(readOne(key))),
    mgetJson: jest.fn((keys: string[]) =>
      Promise.resolve(keys.map((key) => readOne(key))),
    ),
    setJson: jest.fn((key: string, value: unknown) => {
      store.set(key, JSON.stringify(value));
      return Promise.resolve();
    }),
    set: jest.fn((key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve();
    }),
    get: jest.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    del: jest.fn((key: string) => {
      store.delete(key);
      return Promise.resolve();
    }),
  };
};

const makeContext = (): ClubCurrentContext => {
  const user: AuthenticatedUser = {
    id: 201,
    email: 'club_phone_13800138000@purelyprofit.local',
    phone: '13800138000',
    name: '会员用户',
    createdAt: NOW,
    updatedAt: NOW,
    lastActiveAt: null,
    accountScope: 'purely_club',
    currentMembership: null,
  };
  return {
    user,
    store: {
      id: 11,
      name: '望京旗舰店',
      address: '',
      businessMode: 'general',
      memberCareEnabled: false,
      createdAt: NOW,
      updatedAt: NOW,
    },
  };
};

describe('ClubCheckInService · 签到状态缓存命中', () => {
  const createStack = () => {
    const redis = createMemoryRedis();
    const prisma = {
      marketingPromotion: {
        findFirst: jest.fn().mockResolvedValue({
          id: 7,
          enabled: true,
          startAt: START_AT,
          endAt: END_AT,
          params: { pointsPerCheckIn: 3 },
        }),
      },
      clubDailyCheckInRecord: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const pointsQuery = {
      findCustomerWithMemberLink: jest.fn().mockResolvedValue({
        id: 55,
        points: 128,
        memberId: 88,
        clubUserId: 201,
      }),
    };

    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    const redisAny = redis as any;
    const cacheService = new ClubCheckInCacheService(
      redis as unknown as RedisService,
    );
    const queryService = new ClubCheckInQueryService(
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      prisma as any,
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      pointsQuery as any,
      cacheService,
    );
    const statusService = new ClubCheckInStatusService(
      queryService,
      cacheService,
    );
    const service = new ClubCheckInService(
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      prisma as any,
      redisAny,
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      { invalidateMarketingCustomerDerived: jest.fn() } as any,
      queryService,
      cacheService,
      statusService,
    );

    return { service, redis, prisma, pointsQuery, cacheService };
  };

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('第二次进入首页不再查 DB（状态缓存命中）', async () => {
    const { service, prisma, pointsQuery } = createStack();

    await service.getStatus(makeContext());
    expect(pointsQuery.findCustomerWithMemberLink).toHaveBeenCalledTimes(1);
    expect(prisma.marketingPromotion.findFirst).toHaveBeenCalledTimes(1);

    await service.getStatus(makeContext());
    expect(pointsQuery.findCustomerWithMemberLink).toHaveBeenCalledTimes(1);
    expect(prisma.marketingPromotion.findFirst).toHaveBeenCalledTimes(1);
    expect(prisma.clubDailyCheckInRecord.findMany).toHaveBeenCalledTimes(1);
  });

  it('命中缓存时 serverTime 覆盖为当前时间，其余字段沿用服务端结论', async () => {
    const { service } = createStack();

    const first = await service.getStatus(makeContext());
    jest.setSystemTime(new Date(NOW.getTime() + 5_000));
    const second = await service.getStatus(makeContext());

    expect(second.serverTime).toBe(NOW.getTime() + 5_000);
    expect(second).toEqual({ ...first, serverTime: NOW.getTime() + 5_000 });
  });

  it('签到落账后删除当天状态缓存，下次请求重新计算（活动配置仍命中门店级缓存）', async () => {
    const { service, prisma, pointsQuery, redis } = createStack();

    await service.getStatus(makeContext());
    await service.getStatus(makeContext());
    expect(pointsQuery.findCustomerWithMemberLink).toHaveBeenCalledTimes(1);

    // 与 submit 成功后的 deleteStatus 删的是同一个 key
    await redis.del('club:check-in-status:store:11:user:201:day:2026-11-06');

    await service.getStatus(makeContext());
    // 顾客档案重新读取，活动配置仍命中门店级缓存
    expect(pointsQuery.findCustomerWithMemberLink).toHaveBeenCalledTimes(2);
    expect(prisma.marketingPromotion.findFirst).toHaveBeenCalledTimes(1);
  });
});
