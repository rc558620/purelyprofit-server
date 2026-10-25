import { BadRequestException } from '@nestjs/common';
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
        profitOnlineCount: 6,
        clubOnlineCount: 4,
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
        id: 11,
        name: '张三',
        region: ['广东省', '深圳市'],
        orders: 2,
        revenue: 5000,
      },
      {
        id: 12,
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
      {
        id: '11',
        name: '张三',
        city: '深圳市',
        orders: 2,
        revenue: 5000,
        revenueDisplay: '50',
      },
      {
        id: '12',
        name: '李四',
        city: '北京市',
        orders: 1,
        revenue: 1000,
        revenueDisplay: '10',
      },
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
        cacheKey:
          'pulse:dashboard:home:period:month:region:all:regionCode:all:day:na:start:na:end:na',
        ttlSeconds: 30,
      }),
    );
  });

  it('getHome 在线统计取真实鉴权活跃时间：总数 / 两端拆分 / 今日峰值 / 趋势 / 环比', async () => {
    // 冻结时间 2026-05-30T12:00Z；上海时区今日起点 = 05-29T16:00Z，昨日起点 = 05-28T16:00Z
    // 趋势窗口 = 最近 10 小时 = [05-30T02:00Z, 05-30T12:00Z)
    // 实时在线窗口 = [05-30T11:50Z, ∞)
    prismaService.user.findMany.mockResolvedValue([
      // 在线窗口内：2 个商家端（含历史 phone_ 前缀）+ 1 个个人端
      {
        lastActiveAt: new Date('2026-05-30T11:55:00.000Z'),
        email: 'profit_phone_13800138000@purelyprofit.local',
      },
      {
        lastActiveAt: new Date('2026-05-30T11:52:00.000Z'),
        email: 'phone_13900139000@purelyprofit.local',
      },
      {
        lastActiveAt: new Date('2026-05-30T11:51:00.000Z'),
        email: 'club_phone_13700137000@purelyprofit.local',
      },
      // 今日活跃但已滑出在线窗口
      {
        lastActiveAt: new Date('2026-05-30T11:10:00.000Z'),
        email: 'profit_phone_13600136000@purelyprofit.local',
      },
      {
        lastActiveAt: new Date('2026-05-30T02:30:00.000Z'),
        email: 'club_wechat_openid_1@purelyprofit.local',
      },
      {
        lastActiveAt: new Date('2026-05-29T20:00:00.000Z'),
        email: 'profit_phone_13500135000@purelyprofit.local',
      },
      {
        lastActiveAt: new Date('2026-05-29T10:00:00.000Z'),
        email: 'profit_phone_13400134000@purelyprofit.local',
      },
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

    // 趋势 / 环比 / 实时在线三个窗口取并集，一次查询拿全
    expect(prismaService.user.findMany).toHaveBeenCalledWith({
      where: {
        lastActiveAt: { gte: new Date('2026-05-28T16:00:00.000Z') },
      },
      select: { lastActiveAt: true, email: true },
    });
    // 今日 6 人活跃、昨日 1 人 → 环比 (6-1)/1 = 500%
    // 今日小时桶：11:00-12:00 有 4 人（峰值）
    expect(result.online).toEqual({
      onlineCount: 3,
      profitOnlineCount: 2,
      clubOnlineCount: 1,
      onlinePeak: 4,
      onlineChangeRatio: 500,
      onlineTrend: [1, 0, 0, 0, 0, 0, 0, 0, 0, 4],
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
      profitOnlineCount: 0,
      clubOnlineCount: 0,
      onlinePeak: 0,
      onlineChangeRatio: 0,
      onlineTrend: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    });
  });

  it('getHome 带 region 时会把 region 传给 partnerTop SQL 查询', async () => {
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

    expect(serializeQueryRawCall(0)).toContain('%深圳%');
    expect(prismaService.$queryRaw).toHaveBeenCalled();
  });

  it('getHome 同时带 region 与 regionCode 时，SQL 按「名称 OR 编码」匹配整条 region', async () => {
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

  it('getHome 传 customDate 时按该自然日统计收入，环比窗口取前一天', async () => {
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

    const result = await service.getHome(user, {
      revenuePeriod: 'month',
      customDate: '2026-05-21',
    });

    // 订单查询范围 = 所选当日 ∪ 前一天；上海时区下 05-21 = [05-20T16:00Z, 05-21T15:59:59.999Z]
    expect(prismaService.storeMembershipOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          createdAt: {
            gte: new Date('2026-05-19T16:00:00.000Z'),
            lte: new Date('2026-05-21T15:59:59.999Z'),
          },
        }),
      }),
    );
    // 趋势只统计所选当日，不含环比日
    expect(prismaService.storeMembershipOrder.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          createdAt: {
            gte: new Date('2026-05-20T16:00:00.000Z'),
            lte: new Date('2026-05-21T15:59:59.999Z'),
          },
        }),
      }),
    );
    // 自定义日期必须进入缓存键，否则会被同周期的默认查询命中复用
    expect(refreshableCache.getOrLoadRefreshableJson).toHaveBeenCalledWith(
      expect.objectContaining({
        cacheKey: expect.stringContaining('day:2026-05-21'),
      }),
    );
    expect(result.revenueSummary).toEqual({
      total: 0,
      totalDisplay: '0',
      avg: 0,
      avgDisplay: '0',
      growth: 0,
    });
  });

  it('getHome 自定义区间缺失一端时抛 400，且不落到数据库查询', async () => {
    await expect(
      service.getHome(user, {
        revenuePeriod: 'month',
        customRangeStart: '2026-05-01',
      }),
    ).rejects.toThrow(BadRequestException);

    expect(prismaService.storePartner.count).not.toHaveBeenCalled();
    expect(prismaService.storeMembershipOrder.findMany).not.toHaveBeenCalled();
  });

  it('getHome 自定义区间开始晚于结束时抛 400', async () => {
    await expect(
      service.getHome(user, {
        revenuePeriod: 'month',
        customRangeStart: '2026-05-21',
        customRangeEnd: '2026-05-01',
      }),
    ).rejects.toThrow(BadRequestException);

    expect(prismaService.storePartner.count).not.toHaveBeenCalled();
  });
});
