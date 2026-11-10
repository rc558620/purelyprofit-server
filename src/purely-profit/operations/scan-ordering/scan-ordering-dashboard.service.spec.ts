import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { ScanOrderingDashboardService } from './scan-ordering-dashboard.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { RefreshableCacheService } from '../../../redis/refreshable-cache.service';

describe('ScanOrderingDashboardService', () => {
  let service: ScanOrderingDashboardService;

  const prismaService = {
    scanOrders: {
      aggregate: jest.fn(),
      count: jest.fn(),
    },
    scanOrderingTable: {
      groupBy: jest.fn(),
    },
  };
  const commerceAccessService = {
    resolveSingleStoreId: jest.fn(),
  };
  const refreshableCache = {
    getOrLoadRefreshableJson: jest.fn(),
  };
  const user = { id: 1 } as AuthenticatedUser;

  beforeEach(async () => {
    jest.clearAllMocks();
    // 默认透传 loadValue，保证原有统计口径断言仍走真实查询逻辑
    refreshableCache.getOrLoadRefreshableJson.mockImplementation(
      async (options: { loadValue: () => Promise<unknown> }) =>
        options.loadValue(),
    );
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScanOrderingDashboardService,
        { provide: PrismaService, useValue: prismaService },
        { provide: CommerceAccessService, useValue: commerceAccessService },
        { provide: RefreshableCacheService, useValue: refreshableCache },
      ],
    }).compile();
    service = module.get<ScanOrderingDashboardService>(
      ScanOrderingDashboardService,
    );
    commerceAccessService.resolveSingleStoreId.mockResolvedValue(11);
    prismaService.scanOrders.aggregate.mockResolvedValue({
      _sum: { paidAmount: 12550 },
    });
    prismaService.scanOrders.count
      .mockResolvedValueOnce(8)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3);
    prismaService.scanOrderingTable.groupBy.mockResolvedValue([
      { status: 'empty', _count: { _all: 4 } },
      { status: 'dining', _count: { _all: 2 } },
    ]);
  });

  it('按上海今日创建时间统计订单，并以未退款支付金额统计净营业额', async () => {
    const result = await service.getDashboard(user);

    expect(result).toMatchObject({
      paidRevenue: 125.5,
      paidOrderCount: 8,
      pendingOrderCount: 2,
      preparingOrderCount: 3,
      tableStatusSummary: { empty: 4, dining: 2, clearing: 0, disabled: 0 },
    });
    expect(prismaService.scanOrders.aggregate).toHaveBeenCalledWith({
      where: expect.objectContaining({
        storeId: 11,
        paidAt: { gte: expect.any(Date), lt: expect.any(Date) },
        paymentStatus: { in: ['paid', 'refunding'] },
      }),
      _sum: { paidAmount: true },
    });
    expect(prismaService.scanOrders.count).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          storeId: 11,
          createdAt: { gte: expect.any(Date), lt: expect.any(Date) },
        }),
      }),
    );
  });

  it('待接单和制作中仅统计当前用餐轮次中的订单', async () => {
    await service.getDashboard(user);

    const pendingQuery = prismaService.scanOrders.count.mock.calls[1]?.[0];
    const preparingQuery = prismaService.scanOrders.count.mock.calls[2]?.[0];
    expect(pendingQuery.where.storeId).toBe(11);
    expect(pendingQuery.where.status).toBe('pending_acceptance');
    expect(preparingQuery.where.status).toBe('preparing');
    // 轮次口径：命中「当前用餐轮次会话」的订单，或手工补录单（无会话）都要纳入
    expect(pendingQuery.where.OR).toHaveLength(2);
    expect(preparingQuery.where.OR).toHaveLength(2);
    expect(pendingQuery.where.OR[0]).toMatchObject({
      session: {
        is: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({ status: 'active', deletedAt: null }),
            expect.objectContaining({ status: 'left' }),
          ]),
        }),
      },
    });
    expect(pendingQuery.where.OR[1]).toMatchObject({ manualEntry: true });
  });

  it('退款中统计仅计入 status=refunding 且 paymentStatus=refunding（已退款 rejected+refunded 不计入）', async () => {
    prismaService.scanOrders.count.mockReset();
    prismaService.scanOrders.count
      .mockResolvedValueOnce(8) // paidOrderCount
      .mockResolvedValueOnce(2) // pendingOrderCount
      .mockResolvedValueOnce(3) // preparingOrderCount
      .mockResolvedValueOnce(4); // refundingOrderCount

    const result = await service.getDashboard(user);

    expect(result.pendingOrderCount).toBe(2);
    expect(result.preparingOrderCount).toBe(3);
    expect(result.refundingOrderCount).toBe(4);

    const refundingQuery = prismaService.scanOrders.count.mock.calls[3]?.[0];
    expect(refundingQuery.where.storeId).toBe(11);
    expect(refundingQuery.where.status).toBe('refunding');
    expect(refundingQuery.where.paymentStatus).toBe('refunding');
    // 已退款（rejected + refunded）不会被退款中统计查询命中
    expect(refundingQuery.where.status).not.toBe('rejected');
  });

  it('缓存命中时不再执行任何看板 SQL，且缓存 key 按门店隔离', async () => {
    const cached = { businessDate: '2026-11-10', paidRevenue: 99 };
    refreshableCache.getOrLoadRefreshableJson.mockResolvedValue(cached);

    const result = await service.getDashboard(user);

    expect(result).toBe(cached);
    expect(prismaService.scanOrders.aggregate).not.toHaveBeenCalled();
    expect(prismaService.scanOrders.count).not.toHaveBeenCalled();
    const options =
      refreshableCache.getOrLoadRefreshableJson.mock.calls[0]?.[0];
    expect(options.cacheKey).toBe('profit:scan-ordering:dashboard:store:11');
    expect(options.ttlSeconds).toBe(15);
  });

  it('Redis 异常时降级为实时查询，看板仍可用', async () => {
    refreshableCache.getOrLoadRefreshableJson.mockRejectedValue(
      new Error('redis unavailable'),
    );
    prismaService.scanOrders.count.mockReset();
    prismaService.scanOrders.count.mockResolvedValue(0);

    const result = await service.getDashboard(user);

    expect(result.paidRevenue).toBe(125.5);
    expect(prismaService.scanOrders.aggregate).toHaveBeenCalledTimes(1);
  });
});
