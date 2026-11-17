// 客存门店统计服务单测：统计缓存的「口径有效截止时间」与缓存击穿合并
//
// 回归重点：统计走缓存。若缓存结果的时间口径已经开始漂移却仍被复用，
// 同屏就会出现「统计显示在存 10 件、列表此刻只有 9 条」的对不上账。
// 因此缓存必须携带「口径有效截止时间」，越过即重算。
import { CustodySummaryService } from './custody-summary.service';

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
  const readSummaryCache = jest
    .fn()
    .mockResolvedValue(overrides.cached ?? null);
  const writeSummaryCache = jest.fn().mockResolvedValue(undefined);
  const custodyCodeService = { readSummaryCache, writeSummaryCache };

  const service = new CustodySummaryService(
    prisma as never,
    custodyCodeService as never,
  );
  return { service, prisma, readSummaryCache, writeSummaryCache };
};

describe('CustodySummaryService 统计缓存口径', () => {
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
