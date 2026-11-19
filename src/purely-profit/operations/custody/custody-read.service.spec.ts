// 客存 B 端读服务的列表路径单测：列表总数按筛选组合缓存、互不串号
//
// 统计口径（缓存有效期 / 跨月漂移 / 缓存击穿）的回归用例在
// custody-summary.service.spec.ts，本文件只覆盖列表总数与游标口径。
import { CustodyReadService } from './custody-read.service';
import { CustodySummaryService } from './custody-summary.service';

const STORE_ID = 7;

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
    // 必须是「相对当前时间」的未来时刻：写死日期会在到期后变成脏缓存，
    // 使统计走重算分支、多打一次 count，本文件的用例会随日期推移集体变红。
    validUntil: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
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
    new CustodySummaryService(prisma as never, custodyCodeService as never),
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

    /*
     * 只选不随时间漂移的口径：stored / expired 的条数会随 expireAt 越过当前时刻变化，
     * 已被排除在总数缓存之外（见下方时间敏感口径用例），不适合用来断言缓存分字段。
     */
    await service.listOrders({} as never, LIST_PARAMS);
    await service.listOrders({} as never, { ...LIST_PARAMS, status: 'draft' });
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
