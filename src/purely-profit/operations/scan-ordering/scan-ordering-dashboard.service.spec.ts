import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { ScanOrderingDashboardService } from './scan-ordering-dashboard.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';

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
  const user = { id: 1 } as AuthenticatedUser;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScanOrderingDashboardService,
        { provide: PrismaService, useValue: prismaService },
        { provide: CommerceAccessService, useValue: commerceAccessService },
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
    expect(pendingQuery.where.session.is.OR).toHaveLength(2);
    expect(preparingQuery.where.session.is.OR).toHaveLength(2);
    expect(pendingQuery.where.session.is.OR[0]).toMatchObject({
      status: 'active',
      deletedAt: null,
    });
    expect(pendingQuery.where.session.is.OR[1]).toMatchObject({
      status: 'left',
    });
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
});
