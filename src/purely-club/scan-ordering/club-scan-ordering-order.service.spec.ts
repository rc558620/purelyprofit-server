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
import { ScanOrderingPickupNumberService } from './scan-ordering-pickup-number.service';
import { ClubScanOrderingInventoryReservationService } from './club-scan-ordering-inventory-reservation.service';
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
        {
          provide: ClubScanOrderingInventoryReservationService,
          useValue: { reserveMenuProductStock: jest.fn() },
        },
        ClubScanOrderingOrderQueryService,
        ClubScanOrderingOrderHistoryService,
        ClubScanOrderingOrderPreviewService,
        {
          provide: ScanOrderingPickupNumberService,
          useValue: {
            formatPickupNumber: (n: number | null | undefined) =>
              n == null
                ? null
                : n < 1000
                  ? String(n).padStart(3, '0')
                  : String(n),
          },
        },
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
    prismaWithOrderList.scanOrderingSession.findMany
      .mockResolvedValueOnce([
        { diningRoundId: '6d96b3dc-7fb9-4f04-ae87-bb7fd8e57f1e' },
      ])
      .mockResolvedValueOnce([]);
    prismaWithOrderList.scanOrderingMenuProduct.findMany.mockResolvedValue([]);

    await service.listOrders(user, {} as never);

    expect(
      prismaWithOrderList.scanOrderingSession.findMany.mock.calls[1][0].select
        .orders.orderBy,
    ).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    expect(
      prismaWithOrderList.scanOrderingSession.findMany.mock.calls[1][0].where
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
    const activeDiningRoundId = '6d96b3dc-7fb9-4f04-ae87-bb7fd8e57f1e';
    prismaWithOrderList.scanOrderingSession.findMany
      .mockResolvedValueOnce([{ diningRoundId: activeDiningRoundId }])
      .mockResolvedValueOnce([]);
    prismaWithOrderList.scanOrderingMenuProduct.findMany.mockResolvedValue([]);

    await service.listOrders(user, {} as never);

    expect(
      prismaWithOrderList.scanOrderingSession.findMany.mock.calls[1][0].where
        .OR,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: 'active' }),
        expect.objectContaining({
          status: 'left',
          diningRoundId: { in: [activeDiningRoundId] },
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

  it('订单详情返回 discountAmount 且金额统一为元', async () => {
    prisma.scanOrders.findFirst.mockResolvedValue({
      id: 88,
      orderNo: 'SO88',
      status: 'served',
      paymentStatus: 'paid',
      itemOriginalAmount: 14300,
      specificationExtraAmount: 400,
      productDiscountAmount: 1000,
      orderDiscountAmount: 500,
      payableAmount: 12850,
      paidAmount: 12850,
      marketingSnapshot: { pointsDeductAmount: 350 },
      items: [
        {
          id: 1,
          unitPriceAmount: 3000,
          lineTotalAmount: 3000,
          payableLineAmount: 2800,
          specs: [],
        },
      ],
      paymentAttempts: [],
      refundTasks: [],
      balanceTransactions: [],
    });

    const order = (await service.getOrder(user, 88)) as {
      itemOriginalAmount: number;
      specificationExtraAmount: number;
      productDiscountAmount: number;
      orderDiscountAmount: number;
      pointsDeductAmount: number;
      discountAmount: number;
      payableAmount: number;
      paidAmount: number;
      items: Array<{
        unitPriceAmount: number;
        lineTotalAmount: number;
        payableLineAmount: number;
      }>;
    };

    expect(order).toMatchObject({
      itemOriginalAmount: 143,
      specificationExtraAmount: 4,
      productDiscountAmount: 10,
      orderDiscountAmount: 5,
      pointsDeductAmount: 3.5,
      discountAmount: 18.5,
      payableAmount: 128.5,
      paidAmount: 128.5,
    });
    expect(order.items[0]).toMatchObject({
      unitPriceAmount: 30,
      lineTotalAmount: 30,
      payableLineAmount: 28,
    });
    // 营销快照保留：作为优惠清单（discountItems）的数据源供前端展示
    expect(order).toHaveProperty('marketingSnapshot');
  });

  it('订单详情无优惠订单返回 discountAmount 0', async () => {
    prisma.scanOrders.findFirst.mockResolvedValue({
      id: 89,
      orderNo: 'SO89',
      status: 'completed',
      paymentStatus: 'paid',
      itemOriginalAmount: 8000,
      specificationExtraAmount: 0,
      productDiscountAmount: 0,
      orderDiscountAmount: 0,
      payableAmount: 8000,
      paidAmount: 8000,
      marketingSnapshot: null,
      items: [],
      paymentAttempts: [],
      refundTasks: [],
      balanceTransactions: [],
    });

    const order = (await service.getOrder(user, 89)) as {
      discountAmount: number;
    };
    expect(order.discountAmount).toBe(0);
  });

  it('当前订单列表返回 discountAmount 且包含营销快照（优惠清单数据源）', async () => {
    const createdAt = new Date('2026-08-02T01:00:00.000Z');
    const lastActiveAt = new Date('2026-08-02T01:01:00.000Z');
    const prismaWithOrderList = prisma as typeof prisma & {
      scanOrderingSession: { findMany: jest.Mock };
      scanOrderingMenuProduct: { findMany: jest.Mock };
    };
    prismaWithOrderList.scanOrderingSession = { findMany: jest.fn() };
    prismaWithOrderList.scanOrderingMenuProduct = { findMany: jest.fn() };
    prismaWithOrderList.scanOrderingSession.findMany
      .mockResolvedValueOnce([
        { diningRoundId: '6d96b3dc-7fb9-4f04-ae87-bb7fd8e57f1e' },
      ])
      .mockResolvedValueOnce([
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
              status: 'served',
              paymentStatus: 'paid',
              fulfillmentStatus: 'served',
              payableAmount: 12850,
              paidAmount: 12850,
              itemOriginalAmount: 14300,
              specificationExtraAmount: 400,
              productDiscountAmount: 1000,
              orderDiscountAmount: 500,
              marketingSnapshot: { pointsDeductAmount: 350 },
              remark: null,
              createdAt,
              paymentExpiresAt: null,
              acceptedAt: null,
              pickupNumber: 3,
              pickupBusinessDate: null,
              pickupNumberStatus: null,
              pickupCalledAt: null,
              pickupCompletedAt: null,
              paymentAttempts: [],
              refundTasks: [],
              balanceTransactions: [],
              items: [],
            },
          ],
        },
      ]);
    prismaWithOrderList.scanOrderingMenuProduct.findMany.mockResolvedValue([]);

    const result = (await service.listOrders(user, {} as never)) as {
      items: Array<{
        orders: Array<Record<string, unknown>>;
      }>;
    };
    const order = result.items[0].orders[0];
    expect(order.discountAmount).toBe(18.5);
    expect(order.payableAmount).toBe(128.5);
    // 营销快照保留：作为优惠清单（discountItems）的数据源供前端展示
    expect(order).toHaveProperty('marketingSnapshot');
  });

  it('历史点餐记录返回 discountAmount', async () => {
    const createdAt = new Date('2026-08-02T03:00:00.000Z');
    const prismaWithHistory = prisma as typeof prisma & {
      scanOrderingSession: { findMany: jest.Mock };
      scanOrderingMenuProduct: { findMany: jest.Mock };
    };
    prismaWithHistory.scanOrderingSession = { findMany: jest.fn() };
    prismaWithHistory.scanOrderingMenuProduct = { findMany: jest.fn() };
    prismaWithHistory.scanOrderingSession.findMany.mockResolvedValue([
      {
        id: 30,
        storeId: 2,
        guestCount: 1,
        status: 'checked_out',
        createdAt,
        endedAt: new Date('2026-08-02T04:00:00.000Z'),
        archiveReason: null,
        table: null,
        orders: [
          {
            id: 88,
            orderNo: 'SO88',
            status: 'completed',
            paymentStatus: 'paid',
            fulfillmentStatus: 'closed',
            payableAmount: 12850,
            paidAmount: 12850,
            itemOriginalAmount: 14300,
            specificationExtraAmount: 400,
            productDiscountAmount: 1000,
            orderDiscountAmount: 500,
            marketingSnapshot: { pointsDeductAmount: 350 },
            remark: null,
            createdAt,
            servedAt: new Date('2026-08-02T03:30:00.000Z'),
            pickupNumber: 3,
            pickupBusinessDate: null,
            pickupNumberStatus: null,
            pickupCalledAt: null,
            pickupCompletedAt: null,
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
      items: Array<{
        orders: Array<Record<string, unknown>>;
      }>;
    };
    expect(result.items[0].orders[0].discountAmount).toBe(18.5);
    expect(result.items[0].orders[0].payableAmount).toBe(128.5);
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
