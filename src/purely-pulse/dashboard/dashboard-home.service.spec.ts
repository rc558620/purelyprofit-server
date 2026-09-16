import { Test, TestingModule } from '@nestjs/testing';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { RefreshableCacheService } from '../../redis/refreshable-cache.service';
import { PulseDashboardHomeService } from './dashboard-home.service';

describe('PulseDashboardHomeService', () => {
  let service: PulseDashboardHomeService;

  const prismaService = {
    $queryRaw: jest.fn(),
    storePartner: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
    storePartnerApplication: {
      count: jest.fn(),
    },
    storeMembershipOrder: {
      findMany: jest.fn(),
      count: jest.fn(),
      groupBy: jest.fn(),
    },
    storeMembershipPromoRecord: {
      aggregate: jest.fn(),
    },
    user: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
  };

  const refreshableCache = {
    getOrLoadRefreshableJson: jest.fn(),
  };

  const user: AuthenticatedUser = {
    id: 101,
    email: 'dev@example.com',
    phone: '13800138000',
    name: '开发者',
    createdAt: new Date('2026-05-12T00:00:00.000Z'),
    updatedAt: new Date('2026-05-13T00:00:00.000Z'),
    lastActiveAt: null,
    pulseMode: 'normal',
    isPulseDeveloper: true,
    currentMembership: null,
  };

  /**
   * 把 $queryRaw 模板调用里的插值片段（Prisma.Sql）序列化成可断言字符串。
   * 地区条件是 Prisma.sql 片段，直接断言对象结构不稳定，这里统一取 text + values。
   */
  const serializeQueryRawCall = (callIndex: number): string => {
    const [, ...interpolations] = (prismaService.$queryRaw.mock.calls[
      callIndex
    ] ?? []) as unknown[];

    return interpolations
      .map((item) => {
        const fragment = item as { text?: string; values?: unknown[] };
        return `${fragment?.text ?? ''} ${JSON.stringify(fragment?.values ?? [])}`;
      })
      .join(' | ');
  };

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-30T12:00:00.000Z'));
    jest.clearAllMocks();
    // 在线统计默认无人在线，避免各用例都要显式桩 user 查询
    prismaService.user.count.mockResolvedValue(0);
    prismaService.user.findMany.mockResolvedValue([]);
    refreshableCache.getOrLoadRefreshableJson.mockImplementation(
      async ({ loadValue }: { loadValue: () => Promise<unknown> }) =>
        loadValue(),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PulseDashboardHomeService,
        { provide: PrismaService, useValue: prismaService },
        { provide: RefreshableCacheService, useValue: refreshableCache },
      ],
    }).compile();

    service = module.get<PulseDashboardHomeService>(PulseDashboardHomeService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('getHome 命中缓存时直接返回缓存结果', async () => {
    const cached = {
      online: {
        onlineCount: 10,
        onlinePeak: 20,
        onlineChangeRatio: 12,
        onlineTrend: [1, 2],
      },
      partnerStats: {
        total: 1,
        newThisMonth: 1,
        activeRate: 100,
        totalRevenue: 9900,
        totalOrders: 1,
        avgPerPartner: 9900,
      },
      partnerTop: [],
      revenueTrend: { dates: [], values: [] },
      revenueSummary: { total: 9900, avg: 3300, growth: 0 },
      revenueTypeBreakdown: [],
      pendingApplicationCount: 0,
      generatedAt: Date.now(),
    };
    refreshableCache.getOrLoadRefreshableJson.mockResolvedValue(cached);

    await expect(service.getHome(user, {})).resolves.toEqual(cached);
    expect(prismaService.storePartner.count).not.toHaveBeenCalled();
  });

  it('getHome 未命中缓存时用 planId 聚合类型分布并按 SQL 聚合 partner 排行', async () => {
    prismaService.storePartner.count
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1);
    prismaService.storePartnerApplication.count.mockResolvedValue(3);
    prismaService.storeMembershipOrder.findMany.mockResolvedValue([
      {
        amount: 1000,
        planId: 'monthly',
        createdAt: new Date('2026-05-29T10:00:00.000Z'),
      },
      {
        amount: 3000,
        planId: 'quarterly',
        createdAt: new Date('2026-05-30T09:00:00.000Z'),
      },
      {
        amount: 2000,
        planId: 'monthly',
        createdAt: new Date('2026-05-30T11:00:00.000Z'),
      },
    ]);
    prismaService.$queryRaw.mockResolvedValue([
      {
        name: '张三',
        region: ['广东省', '深圳市'],
        orders: 2,
        revenue: 5000,
      },
      {
        name: '李四',
        region: ['北京市', '北京市'],
        orders: 1,
        revenue: 1000,
      },
    ]);
    prismaService.storeMembershipPromoRecord.aggregate.mockResolvedValue({
      _count: { _all: 3 },
      _sum: { chargedAmount: 6000 },
    });
    prismaService.storeMembershipOrder.count.mockResolvedValue(25);
    prismaService.storeMembershipOrder.groupBy.mockResolvedValue([
      { planId: 'monthly', _count: { _all: 2 } },
      { planId: 'quarterly', _count: { _all: 1 } },
    ]);

    const result = await service.getHome(user, { revenuePeriod: 'month' });

    expect(prismaService.storeMembershipOrder.groupBy).toHaveBeenCalled();
    expect(prismaService.$queryRaw).toHaveBeenCalled();
    expect(result.partnerTop).toEqual([
      { name: '张三', city: '深圳市', orders: 2, revenue: 50 },
      { name: '李四', city: '北京市', orders: 1, revenue: 10 },
    ]);
    expect(result.revenueTypeBreakdown).toEqual([
      { label: '月卡会员', value: 67 },
      { label: '季度会员', value: 33 },
      { label: '年卡会员', value: 0 },
      { label: '永久会员', value: 0 },
      { label: '其他充值', value: 0 },
    ]);
    expect(refreshableCache.getOrLoadRefreshableJson).toHaveBeenCalledWith(
      expect.objectContaining({
        cacheKey: 'pulse:dashboard:home:period:month:region:all:regionCode:all',
        ttlSeconds: 30,
      }),
    );
  });

  it('getHome 在线统计取真实鉴权活跃时间：在线数 / 今日峰值 / 趋势 / 环比', async () => {
    // 冻结时间 2026-05-30T12:00Z；上海时区今日起点 = 05-29T16:00Z，昨日起点 = 05-28T16:00Z
    // 趋势窗口 = 最近 10 小时 = [05-30T02:00Z, 05-30T12:00Z)
    prismaService.user.count.mockResolvedValue(3);
    prismaService.user.findMany.mockResolvedValue([
      { lastActiveAt: new Date('2026-05-30T11:30:00.000Z') }, // 今日 / 趋势第 10 桶
      { lastActiveAt: new Date('2026-05-30T11:10:00.000Z') }, // 今日 / 趋势第 10 桶
      { lastActiveAt: new Date('2026-05-30T02:30:00.000Z') }, // 今日 / 趋势第 1 桶
      { lastActiveAt: new Date('2026-05-29T20:00:00.000Z') }, // 今日（不在趋势窗口）
      { lastActiveAt: new Date('2026-05-29T10:00:00.000Z') }, // 昨日
      { lastActiveAt: new Date('2026-05-20T10:00:00.000Z') }, // 更早：两项统计都不计入
    ]);
    prismaService.storePartner.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);
    prismaService.storePartnerApplication.count.mockResolvedValue(0);
    prismaService.storeMembershipOrder.findMany.mockResolvedValue([]);
    prismaService.$queryRaw.mockResolvedValue([]);
    prismaService.storeMembershipPromoRecord.aggregate.mockResolvedValue({
      _count: { _all: 0 },
      _sum: { chargedAmount: 0 },
    });
    prismaService.storeMembershipOrder.groupBy.mockResolvedValue([]);

    const result = await service.getHome(user, {});

    // 实时在线人数来自「最近 10 分钟有鉴权请求」的计数
    expect(prismaService.user.count).toHaveBeenCalledWith({
      where: {
        lastActiveAt: { gt: new Date('2026-05-30T11:50:00.000Z') },
      },
    });
    // 今日 4 人活跃、昨日 1 人 → 环比 (4-1)/1 = 300%
    // 今日小时桶：13:30-14:00 有 2 人（峰值）
    expect(result.online).toEqual({
      onlineCount: 3,
      onlinePeak: 2,
      onlineChangeRatio: 300,
      onlineTrend: [1, 0, 0, 0, 0, 0, 0, 0, 0, 2],
    });
  });

  it('getHome 在线统计在没人活跃时全为 0（不再用付费会员数估算）', async () => {
    prismaService.storePartner.count
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(0);
    prismaService.storePartnerApplication.count.mockResolvedValue(0);
    prismaService.storeMembershipOrder.findMany.mockResolvedValue([]);
    prismaService.$queryRaw.mockResolvedValue([]);
    prismaService.storeMembershipPromoRecord.aggregate.mockResolvedValue({
      _count: { _all: 0 },
      _sum: { chargedAmount: 0 },
    });
    prismaService.storeMembershipOrder.groupBy.mockResolvedValue([]);

    const result = await service.getHome(user, {});

    expect(result.online).toEqual({
      onlineCount: 0,
      onlinePeak: 0,
      onlineChangeRatio: 0,
      onlineTrend: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    });
  });

  it('getHome 带 region 时会把 region 传给 partnerTop SQL 查询', async () => {
    const queryPartnerTopSpy = jest.spyOn(
      service as never,
      'queryPartnerTop' as never,
    );
    prismaService.storePartner.count
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1);
    prismaService.storePartnerApplication.count.mockResolvedValue(0);
    prismaService.storeMembershipOrder.findMany.mockResolvedValue([]);
    prismaService.$queryRaw.mockResolvedValue([]);
    prismaService.storeMembershipPromoRecord.aggregate.mockResolvedValue({
      _count: { _all: 0 },
      _sum: { chargedAmount: 0 },
    });
    prismaService.storeMembershipOrder.count.mockResolvedValue(10);
    prismaService.storeMembershipOrder.groupBy.mockResolvedValue([]);

    await service.getHome(user, { revenuePeriod: 'month', region: '深圳' });

    expect(queryPartnerTopSpy).toHaveBeenCalledWith('深圳', undefined);
    expect(prismaService.$queryRaw).toHaveBeenCalled();
  });

  it('getHome 同时带 region 与 regionCode 时，SQL 按「名称 OR 编码」匹配整条 region', async () => {
    jest.spyOn(service as never, 'queryPartnerTop' as never);
    prismaService.storePartner.count
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1);
    prismaService.storePartnerApplication.count.mockResolvedValue(0);
    prismaService.storeMembershipOrder.findMany.mockResolvedValue([]);
    prismaService.$queryRaw.mockResolvedValue([]);
    prismaService.storeMembershipPromoRecord.aggregate.mockResolvedValue({
      _count: { _all: 0 },
      _sum: { chargedAmount: 0 },
    });
    prismaService.storeMembershipOrder.count.mockResolvedValue(10);
    prismaService.storeMembershipOrder.groupBy.mockResolvedValue([]);

    await service.getHome(user, {
      revenuePeriod: 'month',
      region: '深圳市',
      regionCode: '440300',
    });

    const serializedCondition = serializeQueryRawCall(0);

    // 覆盖省 / 市 / 区三级（不再只看 region[1] / region[2]）
    expect(serializedCondition).toContain('array_to_string(lp.region');
    // 名称与编码各一条匹配规则，OR 连接
    expect(serializedCondition).toContain(' OR ');
    expect(serializedCondition).toContain('%深圳市%');
    expect(serializedCondition).toContain('%440300%');
  });

  it('getHome 不带地区筛选时不拼接地区条件', async () => {
    jest.spyOn(service as never, 'queryPartnerTop' as never);
    prismaService.storePartner.count
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1);
    prismaService.storePartnerApplication.count.mockResolvedValue(0);
    prismaService.storeMembershipOrder.findMany.mockResolvedValue([]);
    prismaService.$queryRaw.mockResolvedValue([]);
    prismaService.storeMembershipPromoRecord.aggregate.mockResolvedValue({
      _count: { _all: 0 },
      _sum: { chargedAmount: 0 },
    });
    prismaService.storeMembershipOrder.count.mockResolvedValue(10);
    prismaService.storeMembershipOrder.groupBy.mockResolvedValue([]);

    await service.getHome(user, { revenuePeriod: 'month' });

    expect(serializeQueryRawCall(0)).not.toContain('array_to_string');
  });
});
