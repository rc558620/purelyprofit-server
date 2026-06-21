import { Test, TestingModule } from '@nestjs/testing';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
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
  };

  const redisService = {
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

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-30T12:00:00.000Z'));
    jest.clearAllMocks();
    redisService.getOrLoadRefreshableJson.mockImplementation(
      async ({ loadValue }: { loadValue: () => Promise<unknown> }) =>
        loadValue(),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PulseDashboardHomeService,
        { provide: PrismaService, useValue: prismaService },
        { provide: RedisService, useValue: redisService },
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
    redisService.getOrLoadRefreshableJson.mockResolvedValue(cached);

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
      { name: '张三', city: '深圳市', orders: 2, revenue: 5000 },
      { name: '李四', city: '北京市', orders: 1, revenue: 1000 },
    ]);
    expect(result.revenueTypeBreakdown).toEqual([
      { label: '月卡会员', value: 67 },
      { label: '季度会员', value: 33 },
      { label: '年卡会员', value: 0 },
      { label: '永久会员', value: 0 },
      { label: '其他充值', value: 0 },
    ]);
    expect(redisService.getOrLoadRefreshableJson).toHaveBeenCalledWith(
      expect.objectContaining({
        cacheKey: 'pulse:dashboard:home:period:month:region:all',
        ttlSeconds: 30,
      }),
    );
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

    expect(queryPartnerTopSpy).toHaveBeenCalledWith('深圳');
    expect(prismaService.$queryRaw).toHaveBeenCalled();
  });
});
