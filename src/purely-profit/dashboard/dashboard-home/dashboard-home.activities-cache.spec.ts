import {
  buildProfitDashboardHomeActivitiesLiveCacheKey,
  buildProfitDashboardHomeActivitiesStableCacheKey,
} from '../../../redis/keys';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { RefreshableCacheService } from '../../../redis/refreshable-cache.service';
import { loadDashboardHomeActivitiesChunks } from './dashboard-home.activities-cache';
import type { DashboardHomeActivitiesData } from './dashboard-home.types';

const NOW = new Date(2026, 4, 14, 15, 0, 0, 0).getTime();

/** 动态流完整结构包含的全部字段，用于守住「分块合并不丢字段」 */
const ACTIVITIES_FIELDS: Array<keyof DashboardHomeActivitiesData> = [
  'lowStockProducts',
  'overdueAccounts',
  'activePromotions',
  'pendingWithdrawals',
  'upcomingLeaves',
  'todayNewMemberCount',
  'todayRecharges',
  'upcomingReservations',
  'upcomingAccounts',
  'draftPayrolls',
  'inactiveVips',
  'dailyRevenueRows',
  'recentOrders',
  'expiringCustodies',
];

function createPrismaMock(): PrismaService {
  const emptyList = (): jest.Mock => jest.fn().mockResolvedValue([]);

  return {
    member: { count: jest.fn().mockResolvedValue(0) },
    memberRechargeLog: { findMany: emptyList() },
    spaceReservation: { findMany: emptyList() },
    saleOrder: { findMany: emptyList() },
    product: { findMany: emptyList() },
    custodyOrder: { findMany: emptyList() },
    employeeLeave: { findMany: emptyList() },
    financeAccountRecord: { findMany: emptyList() },
    marketingPromotion: { findMany: emptyList() },
    partnerWithdrawal: { findMany: emptyList() },
    employeePayroll: { findMany: emptyList() },
    $queryRaw: emptyList(),
  } as unknown as PrismaService;
}

interface CacheMockOptions {
  cacheKey: string;
  ttlSeconds: number;
  refreshAfterMs: number;
  loadValue: () => Promise<unknown>;
}

function createCacheMock(): jest.Mocked<RefreshableCacheService> {
  return {
    getOrLoadRefreshableJson: jest.fn(async (options: CacheMockOptions) =>
      options.loadValue(),
    ),
    writeRefreshableJson: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<RefreshableCacheService>;
}

describe('loadDashboardHomeActivitiesChunks', () => {
  it('实时块与状态块分别缓存，使用不同缓存键与 TTL', async () => {
    const cache = createCacheMock();

    await loadDashboardHomeActivitiesChunks({
      cache,
      prisma: createPrismaMock(),
      storeId: 18,
      now: NOW,
      refresh: false,
    });

    expect(cache.getOrLoadRefreshableJson).toHaveBeenCalledTimes(2);

    const calls = cache.getOrLoadRefreshableJson.mock.calls as unknown as Array<
      [CacheMockOptions]
    >;
    const [stableOptions, liveOptions] = calls.map(([options]) => options);

    // 状态块排在实时块之前：两块都 miss 时保证 SQL 发起顺序与分块前一致
    expect(stableOptions.cacheKey).toBe(
      buildProfitDashboardHomeActivitiesStableCacheKey(18),
    );
    expect(stableOptions.ttlSeconds).toBe(300);
    expect(stableOptions.refreshAfterMs).toBe(120_000);

    expect(liveOptions.cacheKey).toBe(
      buildProfitDashboardHomeActivitiesLiveCacheKey(18),
    );
    expect(liveOptions.ttlSeconds).toBe(45);
    expect(liveOptions.refreshAfterMs).toBe(15_000);
  });

  it('两块合并后覆盖动态流全部字段', async () => {
    const result = await loadDashboardHomeActivitiesChunks({
      cache: createCacheMock(),
      prisma: createPrismaMock(),
      storeId: 18,
      now: NOW,
      refresh: false,
    });

    expect(Object.keys(result).sort()).toEqual([...ACTIVITIES_FIELDS].sort());
    expect(result.todayNewMemberCount).toBe(0);
    expect(result.overdueAccounts).toEqual([]);
  });

  it('refresh 时跳过读缓存，直接回源并回写两块', async () => {
    const cache = createCacheMock();

    await loadDashboardHomeActivitiesChunks({
      cache,
      prisma: createPrismaMock(),
      storeId: 18,
      now: NOW,
      refresh: true,
    });

    expect(cache.getOrLoadRefreshableJson).not.toHaveBeenCalled();
    expect(cache.writeRefreshableJson).toHaveBeenCalledTimes(2);

    const writeCalls = cache.writeRefreshableJson.mock
      .calls as unknown as Array<[string, unknown, number, number]>;

    // 两块并发回源，回写完成的先后取决于各自查询耗时，不锁定写入顺序
    const ttlByKey = new Map(
      writeCalls.map(([cacheKey, , ttlSeconds]) => [cacheKey, ttlSeconds]),
    );
    expect(
      ttlByKey.get(buildProfitDashboardHomeActivitiesStableCacheKey(18)),
    ).toBe(300);
    expect(
      ttlByKey.get(buildProfitDashboardHomeActivitiesLiveCacheKey(18)),
    ).toBe(45);
  });
});
