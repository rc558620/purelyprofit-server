import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { ClubScanOrderingCartPricingService } from './club-scan-ordering-cart-pricing.service';
import { ClubScanOrderingCheckoutService } from './club-scan-ordering-checkout.service';
import { ClubScanOrderingOrderHistoryService } from './club-scan-ordering-order-history.service';
import { ClubScanOrderingOrderQueryService } from './club-scan-ordering-order-query.service';
import { ClubScanOrderingOrderPreviewService } from './club-scan-ordering-order-preview.service';
import { ClubScanOrderingOrderService } from './club-scan-ordering-order.service';
import { ScanOrderingPricingVersionService } from './scan-ordering-pricing-version.service';
import { ScanOrderingRealtimeService } from './scan-ordering-realtime.service';
import { ScanOrderingUnpaidOrderClosureService } from './scan-ordering-unpaid-order-closure.service';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';

describe('ClubScanOrderingOrderService', () => {
  let service: ClubScanOrderingOrderService;

  const prisma = { scanOrders: { findFirst: jest.fn() } };
  const user = { id: 7 } as AuthenticatedUser;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClubScanOrderingOrderService,
        { provide: PrismaService, useValue: prisma },
        { provide: ScanOrderingUnpaidOrderClosureService, useValue: {} },
        { provide: ScanOrderingPricingVersionService, useValue: {} },
        { provide: ScanOrderingRealtimeService, useValue: {} },
        { provide: ClubScanOrderingCartPricingService, useValue: {} },
        { provide: ClubScanOrderingCheckoutService, useValue: {} },
        ClubScanOrderingOrderQueryService,
        ClubScanOrderingOrderHistoryService,
        ClubScanOrderingOrderPreviewService,
      ],
    }).compile();
    service = module.get(ClubScanOrderingOrderService);
  });

  it('当前订单列表将退款完成时间序列化为 ISO 字符串', async () => {
    const processedAt = new Date('2026-08-02T01:32:00.000Z');
    const createdAt = new Date('2026-08-02T01:00:00.000Z');
    const lastActiveAt = new Date('2026-08-02T01:01:00.000Z');
    const prismaWithOrderList = prisma as typeof prisma & {
      scanOrderingSession: { findMany: jest.Mock };
      scanOrderingMenuProduct: { findMany: jest.Mock };
    };
    prismaWithOrderList.scanOrderingSession = { findMany: jest.fn() };
    prismaWithOrderList.scanOrderingMenuProduct = { findMany: jest.fn() };
    prismaWithOrderList.scanOrderingSession.findMany.mockResolvedValue([
      {
        id: 10,
        storeId: 2,
        guestCount: 1,
        status: 'active',
        createdAt,
        lastActiveAt,
        table: null,
        orders: [
          {
            id: 88,
            orderNo: 'SO88',
            status: 'rejected',
            paymentStatus: 'refunded',
            fulfillmentStatus: 'closed',
            payableAmount: 38050,
            paidAmount: 38050,
            remark: null,
            createdAt,
            paymentExpiresAt: null,
            acceptedAt: null,
            paymentAttempts: [],
            refundTasks: [
              {
                id: 12,
                status: 'succeeded',
                refundSucceededAt: null,
                processedAt,
                triggeredAt: createdAt,
              },
            ],
            balanceTransactions: [],
            items: [],
          },
        ],
      },
    ]);
    prismaWithOrderList.scanOrderingMenuProduct.findMany.mockResolvedValue([]);

    const result = (await service.listOrders(user, {} as never)) as {
      items: Array<{
        orders: Array<{
          refundTasks: Array<{ refundSucceededAt: string | null }>;
        }>;
      }>;
    };

    expect(result.items[0].orders[0].refundTasks[0].refundSucceededAt).toBe(
      processedAt.toISOString(),
    );
  });

  it('left 会话中的待接单订单不会被历史记录伪装成已结束', async () => {
    const prismaWithHistory = prisma as typeof prisma & {
      scanOrderingSession: { findMany: jest.Mock };
      scanOrderingMenuProduct: { findMany: jest.Mock };
    };
    prismaWithHistory.scanOrderingSession = { findMany: jest.fn() };
    prismaWithHistory.scanOrderingMenuProduct = { findMany: jest.fn() };
    prismaWithHistory.scanOrderingSession.findMany.mockResolvedValue([
      {
        id: 20,
        storeId: 2,
        guestCount: 1,
        status: 'left',
        createdAt: new Date('2026-08-02T02:00:00.000Z'),
        endedAt: null,
        archiveReason: null,
        table: null,
        orders: [
          {
            id: 99,
            orderNo: 'SO99',
            status: 'pending_acceptance',
            paymentStatus: 'paid',
            fulfillmentStatus: 'pending',
            payableAmount: 100,
            paidAmount: 100,
            remark: null,
            createdAt: new Date('2026-08-02T02:01:00.000Z'),
            servedAt: null,
            paymentAttempts: [],
            items: [],
            refundTasks: [],
            balanceTransactions: [],
          },
        ],
      },
    ]);
    prismaWithHistory.scanOrderingMenuProduct.findMany.mockResolvedValue([]);

    const result = (await service.listOrderHistory(user, {} as never)) as {
      items: unknown[];
    };

    expect(result.items).toHaveLength(0);
  });

  it('当前订单查询只包含有效 active 会话', async () => {
    const prismaWithOrderList = prisma as typeof prisma & {
      scanOrderingSession: { findMany: jest.Mock };
      scanOrderingMenuProduct: { findMany: jest.Mock };
    };
    prismaWithOrderList.scanOrderingSession = { findMany: jest.fn() };
    prismaWithOrderList.scanOrderingMenuProduct = { findMany: jest.fn() };
    prismaWithOrderList.scanOrderingSession.findMany.mockResolvedValue([]);
    prismaWithOrderList.scanOrderingMenuProduct.findMany.mockResolvedValue([]);

    await service.listOrders(user, {} as never);

    expect(
      prismaWithOrderList.scanOrderingSession.findMany.mock.calls[0][0].select
        .orders.orderBy,
    ).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    expect(
      prismaWithOrderList.scanOrderingSession.findMany.mock.calls[0][0].where
        .OR,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: 'active', deletedAt: null }),
      ]),
    );
  });

  it('当前订单查询仅合并同桌有效 active 会话关联的 left 会话', async () => {
    const prismaWithOrderList = prisma as typeof prisma & {
      scanOrderingSession: { findMany: jest.Mock };
      scanOrderingMenuProduct: { findMany: jest.Mock };
    };
    prismaWithOrderList.scanOrderingSession = { findMany: jest.fn() };
    prismaWithOrderList.scanOrderingMenuProduct = { findMany: jest.fn() };
    prismaWithOrderList.scanOrderingSession.findMany.mockResolvedValue([]);
    prismaWithOrderList.scanOrderingMenuProduct.findMany.mockResolvedValue([]);

    await service.listOrders(user, {} as never);

    expect(
      prismaWithOrderList.scanOrderingSession.findMany.mock.calls[0][0].where
        .OR,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: 'active' }),
        expect.objectContaining({
          status: 'left',
          table: expect.objectContaining({ sessions: expect.any(Object) }),
        }),
      ]),
    );
  });

  it('点餐记录查询订单规格快照', async () => {
    const prismaWithHistory = prisma as typeof prisma & {
      scanOrderingSession: { findMany: jest.Mock };
      scanOrderingMenuProduct: { findMany: jest.Mock };
    };
    prismaWithHistory.scanOrderingSession = { findMany: jest.fn() };
    prismaWithHistory.scanOrderingMenuProduct = { findMany: jest.fn() };
    prismaWithHistory.scanOrderingSession.findMany.mockResolvedValue([]);
    prismaWithHistory.scanOrderingMenuProduct.findMany.mockResolvedValue([]);

    await service.listOrderHistory(user, {} as never);

    expect(
      prismaWithHistory.scanOrderingSession.findMany.mock.calls[0][0].select
        .orders.orderBy,
    ).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    expect(
      prismaWithHistory.scanOrderingSession.findMany.mock.calls[0][0].select
        .orders.select.items.select.specs,
    ).toEqual({
      orderBy: { id: 'asc' },
      select: { specOptionNameSnapshot: true },
    });
  });

  it('订单详情回退返回退款完成时间，不改变订单状态', async () => {
    const processedAt = new Date('2026-08-02T01:32:00.000Z');
    prisma.scanOrders.findFirst.mockResolvedValue({
      id: 88,
      status: 'rejected',
      paymentStatus: 'refunded',
      items: [],
      paymentAttempts: [],
      refundTasks: [
        {
          id: 12,
          status: 'succeeded',
          refundSucceededAt: null,
          processedAt,
          triggeredAt: new Date('2026-08-02T01:30:00.000Z'),
        },
      ],
      balanceTransactions: [],
    });

    const order = (await service.getOrder(user, 88)) as {
      status: string;
      refundTasks: Array<{ refundSucceededAt: Date | null }>;
    };

    expect(order.status).toBe('rejected');
    expect(order.refundTasks[0].refundSucceededAt).toEqual(processedAt);
    expect(prisma.scanOrders.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          balanceTransactions: expect.any(Object),
        }),
      }),
    );
  });
});
