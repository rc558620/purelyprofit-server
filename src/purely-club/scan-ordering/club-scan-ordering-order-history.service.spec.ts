import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { ClubCurrentStoreContextService } from '../stores/club-current-store-context.service';
import { ClubScanOrderingOrderHistoryService } from './club-scan-ordering-order-history.service';
import { ScanOrderingPickupNumberService } from './scan-ordering-pickup-number.service';

describe('ClubScanOrderingOrderHistoryService', () => {
  let service: ClubScanOrderingOrderHistoryService;

  const prisma = {
    scanOrderingSession: { findMany: jest.fn() },
    scanOrderingMenuProduct: { findMany: jest.fn() },
  };
  const pickupNumberService = { formatPickupNumber: jest.fn() };
  const currentStoreContextService = { getCurrentStore: jest.fn() };
  const user = { id: 7 } as AuthenticatedUser;

  const orderRow = (
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> => ({
    id: 1,
    orderNo: 'SO-1',
    status: 'completed',
    paymentStatus: 'paid',
    fulfillmentStatus: 'served',
    payableAmount: 1200,
    paidAmount: 1000,
    itemOriginalAmount: 1000,
    specificationExtraAmount: 200,
    productDiscountAmount: 0,
    orderDiscountAmount: 200,
    marketingSnapshot: { pointsDeductAmount: 100, breakdownItems: [] },
    remark: null,
    createdAt: new Date('2026-11-16T10:00:00.000Z'),
    servedAt: null,
    pickupNumber: 1,
    pickupNumberStatus: 'assigned',
    pickupCalledAt: null,
    pickupCompletedAt: null,
    paymentAttempts: [],
    items: [],
    refundTasks: [],
    balanceTransactions: [],
    ...overrides,
  });

  const itemRow = (
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> => ({
    menuProductId: 88,
    productNameSnapshot: '柠檬茶',
    productImageUrlSnapshot: 'snapshot.png',
    quantity: 2,
    unitPriceAmount: 600,
    lineTotalAmount: 1200,
    payableLineAmount: 1000,
    specs: [{ specOptionNameSnapshot: '大杯' }],
    ...overrides,
  });

  const sessionRow = (
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> => ({
    id: 10,
    diningRoundId: 'round-a',
    storeId: 42,
    guestCount: 2,
    status: 'checked_out',
    createdAt: new Date('2026-11-16T10:00:00.000Z'),
    endedAt: null,
    archiveReason: null,
    table: null,
    orders: [orderRow()],
    ...overrides,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.scanOrderingSession.findMany.mockResolvedValue([sessionRow()]);
    prisma.scanOrderingMenuProduct.findMany.mockResolvedValue([]);
    pickupNumberService.formatPickupNumber.mockReturnValue(null);
    currentStoreContextService.getCurrentStore.mockResolvedValue({ id: 42 });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClubScanOrderingOrderHistoryService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: ScanOrderingPickupNumberService,
          useValue: pickupNumberService,
        },
        {
          provide: ClubCurrentStoreContextService,
          useValue: currentStoreContextService,
        },
      ],
    }).compile();
    service = module.get(ClubScanOrderingOrderHistoryService);
  });

  it('同轮次会话合并后按 createdAt + id 全序排列，与输入顺序无关', async () => {
    const early = orderRow({
      id: 100,
      createdAt: new Date('2026-11-16T10:00:00.000Z'),
    });
    const late = orderRow({
      id: 90,
      createdAt: new Date('2026-11-16T10:00:00.000Z'),
    });
    const sessionsInOrderA = [
      sessionRow({ id: 12, guestCount: 2, orders: [early] }),
      sessionRow({ id: 11, guestCount: 5, orders: [late] }),
    ];
    const sessionsInOrderB = [
      sessionRow({ id: 12, guestCount: 2, orders: [late] }),
      sessionRow({ id: 11, guestCount: 5, orders: [early] }),
    ];

    prisma.scanOrderingSession.findMany.mockResolvedValue(sessionsInOrderA);
    const first = await service.listOrderHistory(user, {} as never);
    prisma.scanOrderingSession.findMany.mockResolvedValue(sessionsInOrderB);
    const second = await service.listOrderHistory(user, {} as never);

    expect(first.items).toHaveLength(1);
    // 相同 createdAt 时 id 大的在前，结果唯一确定
    expect(first.items[0].orders.map((order) => order.id)).toEqual([100, 90]);
    expect(second.items[0].orders.map((order) => order.id)).toEqual([100, 90]);
    // guestCount 取最大值，其余字段保留首次出现的会话
    expect(first.items[0].guestCount).toBe(5);
    expect(first.items[0].id).toBe(12);
  });

  it('整页订单被过滤空时游标仍推进，不提前结束分页', async () => {
    prisma.scanOrderingSession.findMany.mockResolvedValue([
      sessionRow({
        id: 10,
        status: 'left',
        orders: [orderRow({ status: 'preparing' })],
      }),
      sessionRow({ id: 9, orders: [orderRow({ id: 2 })] }),
    ]);

    const result = await service.listOrderHistory(user, { limit: 1 } as never);

    // left 会话里制作中的订单不进历史 → 本页 items 为空
    expect(result.items).toEqual([]);
    // 但仍有下一页，游标必须指向本页最后消费的原始会话，而不是 null
    expect(result.nextCursor).toBe(10);
  });

  it('合并同轮次不会把游标抬高到已消费区间（避免重复拉取）', async () => {
    prisma.scanOrderingSession.findMany.mockResolvedValue([
      sessionRow({ id: 12, orders: [orderRow({ id: 5 })] }),
      sessionRow({ id: 11, orders: [orderRow({ id: 4 })] }),
      sessionRow({
        id: 10,
        diningRoundId: 'round-b',
        orders: [orderRow({ id: 3 })],
      }),
    ]);

    const result = await service.listOrderHistory(user, { limit: 2 } as never);

    // 本页消费到 id=11 为止；用合并结果的 id(12) 做游标会重复拉取 11
    expect(result.nextCursor).toBe(11);
  });

  it('无下一页时游标为 null', async () => {
    const result = await service.listOrderHistory(user, { limit: 20 } as never);

    expect(result.nextCursor).toBeNull();
  });

  it('响应剔除 marketingSnapshot 与明细 menuProductId，金额换算为元', async () => {
    prisma.scanOrderingSession.findMany.mockResolvedValue([
      sessionRow({
        orders: [
          orderRow({
            items: [itemRow()],
            paymentAttempts: [{ paymentChannel: 'wechat' }],
          }),
        ],
      }),
    ]);

    const result = await service.listOrderHistory(user, {} as never);
    const [order] = result.items[0].orders;

    expect(order).not.toHaveProperty('marketingSnapshot');
    // marketingSnapshot 仍参与金额派生：积分抵扣 100 分 → 1 元
    expect(order.pointsDeductAmount).toBe(1);
    expect(order.payableAmount).toBe(12);
    expect(order.paidAmount).toBe(10);
    expect(order.orderDiscountAmount).toBe(2);
    expect(order).not.toHaveProperty('pickupBusinessDate');

    const [item] = order.items;
    expect(item).not.toHaveProperty('menuProductId');
    expect(item.unitPriceAmount).toBe(6);
    expect(item.lineTotalAmount).toBe(12);
    expect(item.payableLineAmount).toBe(10);
    expect(item.specs).toEqual([{ specOptionNameSnapshot: '大杯' }]);
    expect(order.itemsTruncated).toBe(false);
    expect(result.items[0].ordersTruncated).toBe(false);
  });

  it('明细图片快照为空时回落到菜单商品图片', async () => {
    prisma.scanOrderingSession.findMany.mockResolvedValue([
      sessionRow({
        orders: [
          orderRow({
            items: [itemRow({ productImageUrlSnapshot: null })],
          }),
        ],
      }),
    ]);
    prisma.scanOrderingMenuProduct.findMany.mockResolvedValue([
      { id: 88, imageUrl: 'menu.png', product: { image: 'product.png' } },
    ]);

    const result = await service.listOrderHistory(user, {} as never);

    expect(result.items[0].orders[0].items[0].productImageUrlSnapshot).toBe(
      'product.png',
    );
  });

  it('订单数超上界时截断并置 ordersTruncated', async () => {
    const orders = Array.from({ length: 101 }, (_, index) =>
      orderRow({ id: index + 1 }),
    );
    prisma.scanOrderingSession.findMany.mockResolvedValue([
      sessionRow({ orders }),
    ]);

    const result = await service.listOrderHistory(user, {} as never);

    expect(result.items[0].orders).toHaveLength(100);
    expect(result.items[0].ordersTruncated).toBe(true);
  });

  it('明细数超上界时截断并置 itemsTruncated', async () => {
    const items = Array.from({ length: 51 }, (_, index) =>
      itemRow({ menuProductId: index + 1 }),
    );
    prisma.scanOrderingSession.findMany.mockResolvedValue([
      sessionRow({ orders: [orderRow({ items })] }),
    ]);

    const result = await service.listOrderHistory(user, {} as never);

    expect(result.items[0].orders[0].items).toHaveLength(50);
    expect(result.items[0].orders[0].itemsTruncated).toBe(true);
  });

  it('退款成功时间按 succeededAt → processedAt → triggeredAt 兜底', async () => {
    const triggeredAt = new Date('2026-11-16T09:00:00.000Z');
    prisma.scanOrderingSession.findMany.mockResolvedValue([
      sessionRow({
        orders: [
          orderRow({
            refundTasks: [
              {
                status: 'succeeded',
                refundSucceededAt: null,
                processedAt: null,
                triggeredAt,
              },
            ],
          }),
        ],
      }),
    ]);
    prisma.scanOrderingMenuProduct.findMany.mockResolvedValue([]);

    const result = await service.listOrderHistory(user, {} as never);

    expect(result.items[0].orders[0].refundTasks[0].refundSucceededAt).toBe(
      triggeredAt.toISOString(),
    );
  });

  it('按当前门店过滤历史会话，并把游标下推为 id < cursor', async () => {
    await service.listOrderHistory(user, { cursor: 50, limit: 5 } as never);

    const query = prisma.scanOrderingSession.findMany.mock.calls[0][0];
    expect(query.where).toEqual({
      clubUserId: 7,
      storeId: 42,
      status: { in: ['checked_out', 'expired', 'left'] },
      id: { lt: 50 },
    });
    expect(query.orderBy).toEqual({ id: 'desc' });
    expect(query.take).toBe(6);
  });
});
