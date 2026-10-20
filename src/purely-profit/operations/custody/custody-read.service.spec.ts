// 客存 B 端读服务单测：门店统计的缓存口径与列表总数的缓存复用
//
// 回归重点：列表的 total 走缓存，统计也走缓存。
// 若缓存结果的时间口径已经开始漂移却仍被复用，同屏就会出现
// 「统计显示在存 10 件、列表此刻只有 9 条」的对不上账。
// 因此缓存必须携带「口径有效截止时间」，越过即重算。
import { CustodyReadService } from './custody-read.service';

const STORE_ID = 7;
/** 聚合时刻 */
const NOW = new Date('2026-10-01T10:00:00.000Z');

/**
 * 统计聚合的 mock。
 *
 * 在存单量 / 在存件数 / 最近的到期临界点由同一个 aggregate 带出
 * （count + sum + min），只有「进入临期窗口」的临界点仍是独立的 findFirst。
 */
const buildService = (
  overrides: {
    cached?: unknown;
    nextExpireAt?: Date | null;
    nextEnteringWindowAt?: Date | null;
  } = {},
) => {
  const nextExpireAt =
    overrides.nextExpireAt === undefined
      ? new Date('2026-10-05T00:00:00.000Z')
      : overrides.nextExpireAt;
  const custodyOrderCount = jest.fn().mockResolvedValue(3);
  const custodyOrderAggregate = jest.fn().mockResolvedValue({
    _count: { _all: 3 },
    _sum: { remainingQty: 12 },
    _min: { expireAt: nextExpireAt },
  });
  const custodyOrderFindFirst = jest
    .fn()
    .mockResolvedValue(
      overrides.nextEnteringWindowAt
        ? { expireAt: overrides.nextEnteringWindowAt }
        : null,
    );
  const custodyPickupCount = jest.fn().mockResolvedValue(5);

  const prisma = {
    custodyOrder: {
      count: custodyOrderCount,
      aggregate: custodyOrderAggregate,
      findFirst: custodyOrderFindFirst,
    },
    custodyPickup: { count: custodyPickupCount },
  };
  const commerceAccessService = {};
  const readSummaryCache = jest
    .fn()
    .mockResolvedValue(overrides.cached ?? null);
  const writeSummaryCache = jest.fn().mockResolvedValue(undefined);
  const custodyCodeService = { readSummaryCache, writeSummaryCache };

  const service = new CustodyReadService(
    prisma as never,
    commerceAccessService as never,
    custodyCodeService as never,
  );
  return { service, prisma, readSummaryCache, writeSummaryCache };
};

describe('CustodyReadService 统计缓存口径', () => {
  it('缓存未命中时聚合并回写统计与口径有效截止时间', async () => {
    const { service, writeSummaryCache, prisma } = buildService();

    const stats = await service.getSummary(STORE_ID, NOW);

    expect(stats).toEqual({
      storedCount: 3,
      storedQty: 12,
      expiringCount: 3,
      monthPickupCount: 5,
    });
    expect(prisma.custodyOrder.aggregate).toHaveBeenCalled();
    expect(writeSummaryCache).toHaveBeenCalledWith(STORE_ID, {
      stats,
      // 最近的临界点：2026-10-05 有存单到期
      validUntil: '2026-10-05T00:00:00.000Z',
    });
  });

  it('缓存命中且未越过口径有效截止时间时直接复用，不再聚合', async () => {
    const { service, prisma, writeSummaryCache } = buildService({
      cached: {
        stats: {
          storedCount: 9,
          storedQty: 40,
          expiringCount: 1,
          monthPickupCount: 2,
        },
        validUntil: '2026-10-05T00:00:00.000Z',
      },
    });

    const stats = await service.getSummary(STORE_ID, NOW);

    expect(stats.storedCount).toBe(9);
    expect(prisma.custodyOrder.aggregate).not.toHaveBeenCalled();
    expect(writeSummaryCache).not.toHaveBeenCalled();
  });

  /*
   * 核心回归：缓存写在 10-01，口径临界点是 10-02。
   * 当前时间已经越过临界点（说明有存单惰性过期了），
   * 缓存里的数字已经与列表的实时口径不一致，必须重算。
   */
  it('缓存已越过口径有效截止时间时重新聚合，避免与实时列表对不上', async () => {
    const { service, prisma, writeSummaryCache } = buildService({
      cached: {
        stats: {
          storedCount: 9,
          storedQty: 40,
          expiringCount: 1,
          monthPickupCount: 2,
        },
        validUntil: '2026-10-02T00:00:00.000Z',
      },
    });

    const stats = await service.getSummary(
      STORE_ID,
      new Date('2026-10-03T00:00:00.000Z'),
    );

    // 重算后的实时值，而不是缓存里的 9
    expect(stats.storedCount).toBe(3);
    expect(prisma.custodyOrder.aggregate).toHaveBeenCalled();
    expect(writeSummaryCache).toHaveBeenCalled();
  });

  it('临界点恰好等于当前时间时视为已漂移并重新聚合', async () => {
    const { service, prisma } = buildService({
      cached: {
        stats: {
          storedCount: 9,
          storedQty: 40,
          expiringCount: 1,
          monthPickupCount: 2,
        },
        validUntil: NOW.toISOString(),
      },
    });

    await service.getSummary(STORE_ID, NOW);

    expect(prisma.custodyOrder.aggregate).toHaveBeenCalled();
  });

  /*
   * 缓存失效瞬间并发请求会各自跑一遍聚合（缓存击穿）。
   * 同一门店共用同一个在途 Promise，只有第一个请求真正落库聚合。
   */
  it('缓存失效瞬间的并发统计请求只聚合一次', async () => {
    const { service, prisma } = buildService();

    await Promise.all([
      service.getSummary(STORE_ID, NOW),
      service.getSummary(STORE_ID, NOW),
      service.getSummary(STORE_ID, NOW),
    ]);

    expect(prisma.custodyOrder.aggregate).toHaveBeenCalledTimes(1);
  });

  /*
   * 无到期临界点时口径并不「永不漂移」：monthPickupCount 的统计区间按月平移，
   * 临界点因此退化为下月 1 日。此前漏掉这一条，门店在存的全是长期有效单时
   * validUntil 会写成 null（永不失效），跨月后「本月取出次数」一直挂着上月的数字。
   */
  it('无到期临界点时，口径临界点退化为下月 1 日', async () => {
    const { service, writeSummaryCache, readSummaryCache, prisma } =
      buildService({
        nextExpireAt: null,
        nextEnteringWindowAt: null,
      });

    await service.getSummary(STORE_ID, NOW);

    expect(writeSummaryCache).toHaveBeenCalledWith(STORE_ID, {
      stats: expect.objectContaining({ storedCount: 3 }),
      validUntil: '2026-11-01T00:00:00.000Z',
    });

    // 月内任何时刻都未漂移，正常命中缓存
    readSummaryCache.mockResolvedValue({
      stats: {
        storedCount: 3,
        storedQty: 12,
        expiringCount: 0,
        monthPickupCount: 5,
      },
      validUntil: '2026-11-01T00:00:00.000Z',
    });
    const sameMonth = await service.getSummary(
      STORE_ID,
      new Date('2026-10-20T00:00:00.000Z'),
    );
    expect(sameMonth.storedCount).toBe(3);
    // 月内命中缓存：没有再聚合（一次聚合只落一次临期单量 count）
    expect(prisma.custodyOrder.count).toHaveBeenCalledTimes(1);
    expect(readSummaryCache).toHaveBeenCalledTimes(2);
  });

  /*
   * 核心回归：缓存写在 10 月，口径临界点是 11-01。
   * 当前时间已经翻到下个月，monthPickupCount 的统计区间整体平移，
   * 缓存里的「本月取出次数」是上月的数字，必须重算。
   */
  it('跨月后重新聚合，避免「本月取出次数」挂着上月数字', async () => {
    const { service, prisma } = buildService({
      cached: {
        stats: {
          storedCount: 9,
          storedQty: 40,
          expiringCount: 1,
          monthPickupCount: 8,
        },
        validUntil: '2026-11-01T00:00:00.000Z',
      },
    });

    const stats = await service.getSummary(
      STORE_ID,
      new Date('2026-11-02T00:00:00.000Z'),
    );

    // 重算后的实时值，而不是缓存里的 8
    expect(stats.monthPickupCount).toBe(5);
    expect(prisma.custodyOrder.aggregate).toHaveBeenCalled();
  });

  it('临期窗口的进入时刻也算临界点（取两个临界点中较早的那个）', async () => {
    const { service, writeSummaryCache } = buildService({
      nextExpireAt: new Date('2026-10-10T00:00:00.000Z'),
      // 10-04 到期 → 距聚合时刻 3 天，临界点 = 10-01，早于 10-10
      nextEnteringWindowAt: new Date('2026-10-04T00:00:00.000Z'),
    });

    await service.getSummary(STORE_ID, NOW);

    expect(writeSummaryCache).toHaveBeenCalledWith(
      STORE_ID,
      expect.objectContaining({ validUntil: '2026-10-01T00:00:00.000Z' }),
    );
  });
});

/** 列表路径的 mock：门店统计走缓存命中，专注验证总数的缓存行为 */
const buildListService = () => {
  const listCount = jest.fn().mockResolvedValue(42);
  const prisma = {
    custodyOrder: {
      findMany: jest.fn().mockResolvedValue([]),
      count: listCount,
      aggregate: jest.fn().mockResolvedValue({
        _count: { _all: 0 },
        _sum: { remainingQty: 0 },
        _min: { expireAt: null },
      }),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    custodyPickup: { count: jest.fn().mockResolvedValue(0) },
    store: {
      findUnique: jest.fn().mockResolvedValue({ ownerId: 1, name: '总店' }),
    },
    staff: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const commerceAccessService = {
    resolveSingleStoreId: jest.fn().mockResolvedValue(STORE_ID),
  };
  const readSummaryCache = jest.fn().mockResolvedValue({
    stats: {
      storedCount: 0,
      storedQty: 0,
      expiringCount: 0,
      monthPickupCount: 0,
    },
    validUntil: '2026-11-01T00:00:00.000Z',
  });
  const readStoreSnapshot = jest.fn().mockResolvedValue(null);
  const writeStoreSnapshot = jest.fn().mockResolvedValue(undefined);
  const readTotal = jest.fn().mockResolvedValue(null);
  const writeTotal = jest.fn().mockResolvedValue(undefined);
  const custodyCodeService = {
    readSummaryCache,
    writeSummaryCache: jest.fn().mockResolvedValue(undefined),
    readStoreSnapshot,
    writeStoreSnapshot,
    readTotal,
    writeTotal,
  };
  const service = new CustodyReadService(
    prisma as never,
    commerceAccessService as never,
    custodyCodeService as never,
  );
  return { service, prisma, readTotal, writeTotal };
};

const LIST_PARAMS = {
  status: 'all',
  expiring: false,
  keyword: '',
  limit: 10,
};

describe('CustodyReadService 列表总数缓存', () => {
  it('同一筛选组合连续两次列表只落库一次 count，第二次走缓存', async () => {
    const { service, prisma, readTotal, writeTotal } = buildListService();
    readTotal.mockResolvedValueOnce(null).mockResolvedValueOnce(42);

    const first = await service.listOrders({} as never, LIST_PARAMS);
    const second = await service.listOrders({} as never, LIST_PARAMS);

    expect(first.total).toBe(42);
    expect(second.total).toBe(42);
    expect(prisma.custodyOrder.count).toHaveBeenCalledTimes(1);
    expect(writeTotal).toHaveBeenCalledTimes(1);
  });

  it('不同筛选组合各自缓存，互不串号', async () => {
    const { service, prisma, readTotal, writeTotal } = buildListService();
    readTotal.mockResolvedValue(null);

    await service.listOrders({} as never, LIST_PARAMS);
    await service.listOrders({} as never, { ...LIST_PARAMS, status: 'stored' });
    await service.listOrders({} as never, { ...LIST_PARAMS, keyword: '茅台' });

    expect(prisma.custodyOrder.count).toHaveBeenCalledTimes(3);
    expect(writeTotal).toHaveBeenCalledTimes(3);
    // 三个组合对应三个不同的缓存字段
    const fields = writeTotal.mock.calls.map((call) => call[1]);
    expect(new Set(fields).size).toBe(3);
  });

  /*
   * 总条数是全量口径：翻页时不能把游标条件带上，
   * 否则总数会随翻页一路变小，前端拿到的不是稳定值。
   */
  it('总数查询不带游标条件（翻页时总数保持全量口径）', async () => {
    const { service, prisma } = buildListService();

    await service.listOrders({} as never, {
      ...LIST_PARAMS,
      cursor: '1760000000000_9',
    });

    const where = prisma.custodyOrder.count.mock.calls[0]?.[0]?.where;
    expect(JSON.stringify(where ?? {})).not.toContain('createdAt');
  });
});
