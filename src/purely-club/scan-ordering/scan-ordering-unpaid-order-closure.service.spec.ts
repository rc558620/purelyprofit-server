import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { ScanOrderingRealtimeService } from './scan-ordering-realtime.service';
import { ScanOrderingUnpaidOrderClosureService } from './scan-ordering-unpaid-order-closure.service';

describe('ScanOrderingUnpaidOrderClosureService', () => {
  let service: ScanOrderingUnpaidOrderClosureService;

  const prismaService = {
    $transaction: jest.fn(),
    scanOrders: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      updateMany: jest.fn(),
    },
    scanOrderItem: {
      findMany: jest.fn(),
    },
    scanOrderingMenuProduct: {
      updateMany: jest.fn(),
    },
    scanOrderingSpecOption: {
      updateMany: jest.fn(),
    },
    product: {
      updateMany: jest.fn(),
    },
    scanOrderPaymentAttempt: {
      updateMany: jest.fn(),
    },
    scanOrderCouponUsage: {
      updateMany: jest.fn(),
    },
    scanOrderStatusHistory: {
      create: jest.fn(),
    },
  };

  const realtimeService = {
    publishOrderStatusChanged: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    prismaService.$transaction.mockImplementation(
      async (callback: (tx: typeof prismaService) => Promise<unknown>) =>
        callback(prismaService),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScanOrderingUnpaidOrderClosureService,
        { provide: PrismaService, useValue: prismaService },
        {
          provide: ScanOrderingRealtimeService,
          useValue: realtimeService,
        },
      ],
    }).compile();

    service = module.get<ScanOrderingUnpaidOrderClosureService>(
      ScanOrderingUnpaidOrderClosureService,
    );
  });

  // ── 2.1 用户主动取消 ──────────────────────────────────────

  describe('2.1 用户主动取消', () => {
    beforeEach(() => {
      prismaService.scanOrders.findUnique.mockResolvedValue({
        id: 1001,
        storeId: 11,
        sessionId: 55,
        version: 3,
      });
      prismaService.scanOrders.findUniqueOrThrow.mockResolvedValue({
        id: 1001,
        storeId: 11,
      });
      prismaService.scanOrders.updateMany.mockResolvedValue({ count: 1 });
      prismaService.scanOrderItem.findMany.mockResolvedValue([
        {
          menuProductId: 201,
          quantity: 2,
          menuProduct: { productId: 901 },
          specs: [{ specOptionId: 301 }, { specOptionId: 302 }],
        },
      ]);
      prismaService.scanOrderingMenuProduct.updateMany.mockResolvedValue({
        count: 1,
      });
      prismaService.scanOrderingSpecOption.updateMany.mockResolvedValue({
        count: 1,
      });
      prismaService.product.updateMany.mockResolvedValue({ count: 1 });
      prismaService.scanOrderPaymentAttempt.updateMany.mockResolvedValue({
        count: 2,
      });
      prismaService.scanOrderCouponUsage.updateMany.mockResolvedValue({
        count: 1,
      });
      prismaService.scanOrderStatusHistory.create.mockResolvedValue({});
    });

    it('订单变为 cancelled，fulfillmentStatus = closed', async () => {
      const result = await service.close({
        orderId: 1001,
        expectedVersion: 3,
        operatorType: 'club_user',
        operatorId: 201,
        reason: '用户取消',
      });

      expect(result).toEqual({
        orderId: 1001,
        storeId: 11,
        sessionId: 55,
        status: 'cancelled',
        paymentStatus: 'unpaid',
        fulfillmentStatus: 'closed',
      });

      expect(prismaService.scanOrders.updateMany).toHaveBeenCalledWith({
        where: {
          id: 1001,
          version: 3,
          status: 'pending_payment',
          paymentStatus: 'unpaid',
        },
        data: {
          status: 'cancelled',
          fulfillmentStatus: 'closed',
          cancelledAt: expect.any(Date),
          cancelReason: '用户取消',
          version: { increment: 1 },
        },
      });
    });

    it('订单版本加一', async () => {
      await service.close({
        orderId: 1001,
        operatorType: 'club_user',
        operatorId: 201,
        reason: '用户取消',
      });

      expect(prismaService.scanOrders.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            version: { increment: 1 },
          }),
        }),
      );
    });

    it('cancelledAt 有值', async () => {
      await service.close({
        orderId: 1001,
        operatorType: 'club_user',
        operatorId: 201,
        reason: '用户取消',
      });

      expect(prismaService.scanOrders.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            cancelledAt: expect.any(Date),
          }),
        }),
      );
    });

    it('cancelReason 正确', async () => {
      await service.close({
        orderId: 1001,
        operatorType: 'club_user',
        operatorId: 201,
        reason: '用户取消',
      });

      expect(prismaService.scanOrders.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            cancelReason: '用户取消',
          }),
        }),
      );
    });

    it('商品库存恢复（finite 模式）', async () => {
      await service.close({
        orderId: 1001,
        operatorType: 'club_user',
        operatorId: 201,
        reason: '用户取消',
      });

      expect(
        prismaService.scanOrderingMenuProduct.updateMany,
      ).toHaveBeenCalledWith({
        where: { id: 201, storeId: 11, stockMode: 'finite' },
        data: {
          stockQuantity: { increment: 2 },
          salesCount: { decrement: 2 },
          version: { increment: 1 },
        },
      });
    });

    it('规格库存恢复', async () => {
      await service.close({
        orderId: 1001,
        operatorType: 'club_user',
        operatorId: 201,
        reason: '用户取消',
      });

      // 两个 specOptionId 各加 2（因为 quantity=2）
      const calls = prismaService.scanOrderingSpecOption.updateMany.mock.calls;
      const specIds = calls.map((c) => c[0].where.id).sort();
      expect(specIds).toEqual([301, 302]);
      for (const call of calls) {
        expect(call[0].data.stockQuantity).toEqual({ increment: 2 });
      }
    });

    it('created / paying 支付尝试改为 closed', async () => {
      await service.close({
        orderId: 1001,
        operatorType: 'club_user',
        operatorId: 201,
        reason: '用户取消',
      });

      expect(
        prismaService.scanOrderPaymentAttempt.updateMany,
      ).toHaveBeenCalledWith({
        where: {
          orderId: 1001,
          status: { in: ['created', 'paying'] },
        },
        data: { status: 'closed' },
      });
    });

    it('locked 优惠券记录改为 released', async () => {
      await service.close({
        orderId: 1001,
        operatorType: 'club_user',
        operatorId: 201,
        reason: '用户取消',
      });

      expect(
        prismaService.scanOrderCouponUsage.updateMany,
      ).toHaveBeenCalledWith({
        where: { orderId: 1001, status: 'locked' },
        data: { status: 'released', releasedAt: expect.any(Date) },
      });
    });

    it('写入 ScanOrderStatusHistory', async () => {
      await service.close({
        orderId: 1001,
        operatorType: 'club_user',
        operatorId: 201,
        reason: '用户取消',
      });

      expect(prismaService.scanOrderStatusHistory.create).toHaveBeenCalledWith({
        data: {
          orderId: 1001,
          storeId: 11,
          fromStatus: 'pending_payment',
          toStatus: 'cancelled',
          operatorType: 'club_user',
          operatorId: 201,
          reason: '用户取消',
        },
      });
    });

    it('事务成功后调用 publishOrderStatusChanged', async () => {
      await service.close({
        orderId: 1001,
        operatorType: 'club_user',
        operatorId: 201,
        reason: '用户取消',
      });

      expect(realtimeService.publishOrderStatusChanged).toHaveBeenCalledWith({
        orderId: 1001,
        storeId: 11,
        sessionId: 55,
        status: 'cancelled',
        paymentStatus: 'unpaid',
        fulfillmentStatus: 'closed',
      });
    });
  });

  // ── 2.2 重复取消幂等 ──────────────────────────────────────

  describe('2.2 重复取消幂等', () => {
    it('第一次返回成功', async () => {
      prismaService.scanOrders.findUnique.mockResolvedValue({
        id: 1002,
        storeId: 11,
        sessionId: 56,
        version: 1,
      });
      prismaService.scanOrders.findUniqueOrThrow.mockResolvedValue({
        id: 1002,
        storeId: 11,
      });
      prismaService.scanOrders.updateMany.mockResolvedValueOnce({ count: 1 });
      prismaService.scanOrderItem.findMany.mockResolvedValue([]);
      prismaService.scanOrderPaymentAttempt.updateMany.mockResolvedValue({
        count: 0,
      });
      prismaService.scanOrderCouponUsage.updateMany.mockResolvedValue({
        count: 0,
      });
      prismaService.scanOrderStatusHistory.create.mockResolvedValue({});

      const result = await service.close({
        orderId: 1002,
        operatorType: 'club_user',
        operatorId: 201,
        reason: '用户取消',
      });

      expect(result).not.toBeNull();
      expect(prismaService.scanOrderStatusHistory.create).toHaveBeenCalled();
    });

    it('第二次关闭时 updateMany count=0，返回 null，不重复恢复库存', async () => {
      prismaService.scanOrders.findUnique.mockResolvedValue({
        id: 1002,
        storeId: 11,
        sessionId: 56,
        version: 2, // version 已增加
      });
      prismaService.scanOrders.updateMany.mockResolvedValueOnce({ count: 0 }); // 已不是 pending_payment
      prismaService.scanOrderItem.findMany.mockClear();
      prismaService.scanOrderingMenuProduct.updateMany.mockClear();

      const result = await service.close({
        orderId: 1002,
        operatorType: 'club_user',
        operatorId: 201,
        reason: '用户取消',
      });

      expect(result).toBeNull();
      // updateMany count=0 时不应该执行后续库存恢复
      expect(prismaService.scanOrderItem.findMany).not.toHaveBeenCalled();
      expect(
        prismaService.scanOrderingMenuProduct.updateMany,
      ).not.toHaveBeenCalled();
      expect(realtimeService.publishOrderStatusChanged).not.toHaveBeenCalled();
    });
  });

  // ── 2.3 支付超时关闭 ──────────────────────────────────────

  describe('2.3 支付超时关闭', () => {
    beforeEach(() => {
      prismaService.scanOrders.findUnique.mockResolvedValue({
        id: 2001,
        storeId: 11,
        sessionId: 60,
        version: 1,
      });
      prismaService.scanOrders.findUniqueOrThrow.mockResolvedValue({
        id: 2001,
        storeId: 11,
      });
      prismaService.scanOrders.updateMany.mockResolvedValue({ count: 1 });
      prismaService.scanOrderItem.findMany.mockResolvedValue([
        {
          menuProductId: 201,
          quantity: 1,
          menuProduct: { productId: 902 },
          specs: [{ specOptionId: 301 }],
        },
      ]);
      prismaService.scanOrderingMenuProduct.updateMany.mockResolvedValue({
        count: 1,
      });
      prismaService.scanOrderingSpecOption.updateMany.mockResolvedValue({
        count: 1,
      });
      prismaService.product.updateMany.mockResolvedValue({ count: 1 });
      prismaService.scanOrderPaymentAttempt.updateMany.mockResolvedValue({
        count: 1,
      });
      prismaService.scanOrderCouponUsage.updateMany.mockResolvedValue({
        count: 0,
      });
      prismaService.scanOrderStatusHistory.create.mockResolvedValue({});
    });

    it('使用系统操作人类型 system', async () => {
      await service.close({
        orderId: 2001,
        expectedVersion: 1,
        operatorType: 'system',
        reason: '支付超时自动关闭',
      });

      expect(prismaService.scanOrderStatusHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            operatorType: 'system',
            reason: '支付超时自动关闭',
          }),
        }),
      );
    });

    it('关闭原因明确为支付超时关闭', async () => {
      await service.close({
        orderId: 2001,
        expectedVersion: 1,
        operatorType: 'system',
        reason: '支付超时自动关闭',
      });

      expect(prismaService.scanOrders.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            cancelReason: '支付超时自动关闭',
          }),
        }),
      );
    });

    it('补偿行为与用户取消一致：恢复库存、关闭支付尝试、写历史', async () => {
      await service.close({
        orderId: 2001,
        expectedVersion: 1,
        operatorType: 'system',
        reason: '支付超时自动关闭',
      });

      expect(
        prismaService.scanOrderingMenuProduct.updateMany,
      ).toHaveBeenCalled();
      expect(
        prismaService.scanOrderingSpecOption.updateMany,
      ).toHaveBeenCalled();
      expect(
        prismaService.scanOrderPaymentAttempt.updateMany,
      ).toHaveBeenCalled();
      expect(prismaService.scanOrderStatusHistory.create).toHaveBeenCalled();
    });

    it('实时事件发布', async () => {
      await service.close({
        orderId: 2001,
        expectedVersion: 1,
        operatorType: 'system',
        reason: '支付超时自动关闭',
      });

      expect(realtimeService.publishOrderStatusChanged).toHaveBeenCalledWith({
        orderId: 2001,
        storeId: 11,
        sessionId: 60,
        status: 'cancelled',
        paymentStatus: 'unpaid',
        fulfillmentStatus: 'closed',
      });
    });
  });

  // ── 2.4 不应关闭的订单 ─────────────────────────────────────

  describe('2.4 不应关闭的订单', () => {
    const terminalStatuses = [
      'pending_acceptance',
      'preparing',
      'served',
      'completed',
      'cancelled',
      'rejected',
    ];

    beforeEach(() => {
      prismaService.scanOrders.findUnique.mockResolvedValue({
        id: 3001,
        storeId: 11,
        sessionId: 70,
        version: 5,
      });
      prismaService.scanOrderItem.findMany.mockResolvedValue([]);
      prismaService.scanOrderingMenuProduct.updateMany.mockClear();
      prismaService.scanOrderingSpecOption.updateMany.mockClear();
      prismaService.scanOrderPaymentAttempt.updateMany.mockClear();
      prismaService.scanOrderCouponUsage.updateMany.mockClear();
      prismaService.scanOrderStatusHistory.create.mockClear();
    });

    for (const status of terminalStatuses) {
      it(`status=${status} 时 updateMany count=0，不修改订单、不恢复库存、不关闭支付尝试、不写历史、不推送事件`, async () => {
        prismaService.scanOrders.updateMany.mockResolvedValueOnce({ count: 0 });

        const result = await service.close({
          orderId: 3001,
          expectedVersion: 5,
          operatorType: 'system',
          reason: '支付超时自动关闭',
        });

        expect(result).toBeNull();
        expect(prismaService.scanOrderItem.findMany).not.toHaveBeenCalled();
        expect(
          prismaService.scanOrderingMenuProduct.updateMany,
        ).not.toHaveBeenCalled();
        expect(
          prismaService.scanOrderingSpecOption.updateMany,
        ).not.toHaveBeenCalled();
        expect(
          prismaService.scanOrderPaymentAttempt.updateMany,
        ).not.toHaveBeenCalled();
        expect(
          prismaService.scanOrderCouponUsage.updateMany,
        ).not.toHaveBeenCalled();
        expect(
          prismaService.scanOrderStatusHistory.create,
        ).not.toHaveBeenCalled();
        expect(
          realtimeService.publishOrderStatusChanged,
        ).not.toHaveBeenCalled();
      });
    }

    it('paymentStatus=paid 时不应关闭', async () => {
      prismaService.scanOrders.updateMany.mockResolvedValueOnce({ count: 0 });

      const result = await service.close({
        orderId: 3001,
        expectedVersion: 5,
        operatorType: 'system',
        reason: '支付超时自动关闭',
      });

      expect(result).toBeNull();
      // updateMany where 子句已经限制 paymentStatus: 'unpaid'，
      // paid 订单不会匹配，返回 count=0
      expect(prismaService.scanOrders.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            paymentStatus: 'unpaid',
          }),
        }),
      );
    });

    it('订单不存在时返回 null', async () => {
      prismaService.scanOrders.findUnique.mockResolvedValue(null);

      const result = await service.close({
        orderId: 9999,
        operatorType: 'system',
        reason: '支付超时自动关闭',
      });

      expect(result).toBeNull();
      expect(prismaService.scanOrders.updateMany).not.toHaveBeenCalled();
      expect(realtimeService.publishOrderStatusChanged).not.toHaveBeenCalled();
    });
  });

  // ── 2.5 规格数量汇总 ──────────────────────────────────────

  describe('2.5 规格数量汇总', () => {
    it('同一规格项在多个订单项中被选中时，归还数量必须按所有订单项数量求和', async () => {
      prismaService.scanOrders.findUnique.mockResolvedValue({
        id: 4001,
        storeId: 11,
        sessionId: 80,
        version: 1,
      });
      prismaService.scanOrders.findUniqueOrThrow.mockResolvedValue({
        id: 4001,
        storeId: 11,
      });
      prismaService.scanOrders.updateMany.mockResolvedValue({ count: 1 });
      // 两个订单项都选了 specOptionId=301，数量分别为 2 和 3
      prismaService.scanOrderItem.findMany.mockResolvedValue([
        {
          menuProductId: 201,
          quantity: 2,
          menuProduct: { productId: 901 },
          specs: [{ specOptionId: 301 }, { specOptionId: 302 }],
        },
        {
          menuProductId: 202,
          quantity: 3,
          menuProduct: { productId: null },
          specs: [{ specOptionId: 301 }, { specOptionId: 303 }],
        },
      ]);
      prismaService.scanOrderingMenuProduct.updateMany.mockResolvedValue({
        count: 1,
      });
      prismaService.scanOrderingSpecOption.updateMany.mockResolvedValue({
        count: 1,
      });
      prismaService.product.updateMany.mockResolvedValue({ count: 1 });
      prismaService.scanOrderPaymentAttempt.updateMany.mockResolvedValue({
        count: 0,
      });
      prismaService.scanOrderCouponUsage.updateMany.mockResolvedValue({
        count: 0,
      });
      prismaService.scanOrderStatusHistory.create.mockResolvedValue({});

      await service.close({
        orderId: 4001,
        operatorType: 'club_user',
        operatorId: 201,
        reason: '用户取消',
      });

      const specCalls =
        prismaService.scanOrderingSpecOption.updateMany.mock.calls;
      const specMap = new Map<number, number>();
      for (const [call] of specCalls) {
        specMap.set(call.where.id, call.data.stockQuantity.increment);
      }

      // specOptionId=301 出现在两个订单项中，数量分别为 2 和 3，合计应为 5
      expect(specMap.get(301)).toBe(5);
      // specOptionId=302 只在一个订单项中，数量为 2
      expect(specMap.get(302)).toBe(2);
      // specOptionId=303 只在一个订单项中，数量为 3
      expect(specMap.get(303)).toBe(3);
    });

    it('不得按规格项出现次数归还', async () => {
      prismaService.scanOrders.findUnique.mockResolvedValue({
        id: 4002,
        storeId: 11,
        sessionId: 81,
        version: 1,
      });
      prismaService.scanOrders.findUniqueOrThrow.mockResolvedValue({
        id: 4002,
        storeId: 11,
      });
      prismaService.scanOrders.updateMany.mockResolvedValue({ count: 1 });
      // 同一规格出现在 3 个购物车行中，每行数量 1
      prismaService.scanOrderItem.findMany.mockResolvedValue([
        {
          menuProductId: 201,
          quantity: 1,
          menuProduct: { productId: 901 },
          specs: [{ specOptionId: 501 }],
        },
        {
          menuProductId: 202,
          quantity: 1,
          menuProduct: { productId: null },
          specs: [{ specOptionId: 501 }],
        },
        {
          menuProductId: 203,
          quantity: 1,
          menuProduct: { productId: 903 },
          specs: [{ specOptionId: 501 }],
        },
      ]);
      prismaService.scanOrderingMenuProduct.updateMany.mockResolvedValue({
        count: 1,
      });
      prismaService.scanOrderingSpecOption.updateMany.mockResolvedValue({
        count: 1,
      });
      prismaService.product.updateMany.mockResolvedValue({ count: 1 });
      prismaService.scanOrderPaymentAttempt.updateMany.mockResolvedValue({
        count: 0,
      });
      prismaService.scanOrderCouponUsage.updateMany.mockResolvedValue({
        count: 0,
      });
      prismaService.scanOrderStatusHistory.create.mockResolvedValue({});

      await service.close({
        orderId: 4002,
        operatorType: 'club_user',
        operatorId: 201,
        reason: '用户取消',
      });

      // 应该只调用一次 updateMany，increment 为 3（不是 1）
      const specCalls =
        prismaService.scanOrderingSpecOption.updateMany.mock.calls;
      expect(specCalls).toHaveLength(1);
      expect(specCalls[0][0].where.id).toBe(501);
      expect(specCalls[0][0].data.stockQuantity.increment).toBe(3);
    });

    it('不得遗漏相同规格出现在不同商品行的情况', async () => {
      prismaService.scanOrders.findUnique.mockResolvedValue({
        id: 4003,
        storeId: 11,
        sessionId: 82,
        version: 1,
      });
      prismaService.scanOrders.findUniqueOrThrow.mockResolvedValue({
        id: 4003,
        storeId: 11,
      });
      prismaService.scanOrders.updateMany.mockResolvedValue({ count: 1 });
      prismaService.scanOrderItem.findMany.mockResolvedValue([
        {
          menuProductId: 201,
          quantity: 5,
          menuProduct: { productId: 901 },
          specs: [{ specOptionId: 601 }, { specOptionId: 602 }],
        },
        {
          menuProductId: 202,
          quantity: 4,
          menuProduct: { productId: 902 },
          specs: [{ specOptionId: 602 }, { specOptionId: 603 }],
        },
      ]);
      prismaService.scanOrderingMenuProduct.updateMany.mockResolvedValue({
        count: 1,
      });
      prismaService.scanOrderingSpecOption.updateMany.mockResolvedValue({
        count: 1,
      });
      prismaService.product.updateMany.mockResolvedValue({ count: 1 });
      prismaService.scanOrderPaymentAttempt.updateMany.mockResolvedValue({
        count: 0,
      });
      prismaService.scanOrderCouponUsage.updateMany.mockResolvedValue({
        count: 0,
      });
      prismaService.scanOrderStatusHistory.create.mockResolvedValue({});

      await service.close({
        orderId: 4003,
        operatorType: 'club_user',
        operatorId: 201,
        reason: '用户取消',
      });

      const specCalls =
        prismaService.scanOrderingSpecOption.updateMany.mock.calls;
      const specMap = new Map<number, number>();
      for (const [call] of specCalls) {
        specMap.set(call.where.id, call.data.stockQuantity.increment);
      }

      // 601: 只在商品 201 中出现，数量 5
      expect(specMap.get(601)).toBe(5);
      // 602: 在商品 201(数量5) 和 202(数量4) 中都出现，合计 9
      expect(specMap.get(602)).toBe(9);
      // 603: 只在商品 202 中出现，数量 4
      expect(specMap.get(603)).toBe(4);
    });
  });
});
