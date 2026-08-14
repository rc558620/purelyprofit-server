import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { ScanOrderingRealtimeService } from './scan-ordering-realtime.service';
import { ClubPaymentLockService } from '../payments/club-payment-lock.service';
import { ClubScanOrderingPaymentService } from './club-scan-ordering-payment.service';
import { ScanOrderingRefundService } from './scan-ordering-refund.service';
import { ScanOrderingSaleOrderBridgeService } from './scan-ordering-sale-order-bridge.service';
import { ScanOrderingPickupNumberService } from './scan-ordering-pickup-number.service';
import type { ClubPaymentCallbackSettlementParams } from '../payments/club-payments.types';

describe('ClubScanOrderingPaymentService', () => {
  let service: ClubScanOrderingPaymentService;
  let loggerErrorSpy: jest.SpyInstance | null = null;

  const prismaService = {
    $transaction: jest.fn(),
    scanOrderPaymentAttempt: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    scanOrders: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    scanOrderStatusHistory: {
      create: jest.fn(),
    },
  };

  const paymentLockService = {
    withOrderLock: jest.fn(),
  };

  const realtimeService = {
    publishOrderStatusChanged: jest.fn(),
  };

  const refundService = {
    createRefundTaskInTransaction: jest.fn(),
  };

  const saleOrderBridgeService = {
    createForPaidOrder: jest.fn(),
  };

  const pickupNumberService = {
    assignForPaidOrder: jest.fn(),
    formatPickupNumber: jest.fn((n: number | null | undefined) =>
      n == null ? null : n < 1000 ? String(n).padStart(3, '0') : String(n),
    ),
    getShanghaiBusinessDate: jest.fn(),
  };

  const baseSettlement: ClubPaymentCallbackSettlementParams = {
    amountFen: 5000,
    transactionId: '4200001234202606101234567890',
    paidAtMs: 1773558660000,
    callbackReceivedAtMs: 1773558663000,
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    loggerErrorSpy = null;

    // withOrderLock 直接执行回调
    paymentLockService.withOrderLock.mockImplementation(
      async (_key: string, callback: () => Promise<unknown>) => callback(),
    );
    // $transaction 直接执行回调，传入 prismaService 本身作为 tx
    prismaService.$transaction.mockImplementation(
      async (callback: (tx: typeof prismaService) => Promise<unknown>) =>
        callback(prismaService),
    );
    prismaService.scanOrderPaymentAttempt.update.mockResolvedValue({});
    prismaService.scanOrders.update.mockResolvedValue({});
    prismaService.scanOrderStatusHistory.create.mockResolvedValue({});
    refundService.createRefundTaskInTransaction.mockResolvedValue(undefined);
    saleOrderBridgeService.createForPaidOrder.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClubScanOrderingPaymentService,
        { provide: PrismaService, useValue: prismaService },
        { provide: ClubPaymentLockService, useValue: paymentLockService },
        {
          provide: ScanOrderingRealtimeService,
          useValue: realtimeService,
        },
        { provide: ScanOrderingRefundService, useValue: refundService },
        {
          provide: ScanOrderingSaleOrderBridgeService,
          useValue: saleOrderBridgeService,
        },
        {
          provide: ScanOrderingPickupNumberService,
          useValue: pickupNumberService,
        },
      ],
    }).compile();

    service = module.get<ClubScanOrderingPaymentService>(
      ClubScanOrderingPaymentService,
    );
    loggerErrorSpy = jest.spyOn(service['logger'], 'error');
  });

  afterEach(() => {
    if (loggerErrorSpy) {
      loggerErrorSpy.mockRestore();
      loggerErrorSpy = null;
    }
  });

  // ── 4.1 正常支付成功 ──────────────────────────────────────

  describe('4.1 正常支付成功', () => {
    const attemptData = {
      id: 801,
      orderId: 1001,
      amount: 5000,
      status: 'paying',
      providerTransactionId: null,
      paidAt: null,
    };
    const orderPending = {
      id: 1001,
      storeId: 11,
      sessionId: 55,
      orderNo: 'SO20260723120000ABCD',
      status: 'pending_payment',
      paymentStatus: 'unpaid',
      fulfillmentStatus: 'preparing',
      payableAmount: 5000,
      paidAmount: 0,
      version: 1,
    };
    const orderPaid = {
      id: 1001,
      storeId: 11,
      sessionId: 55,
      orderNo: 'SO20260723120000ABCD',
      status: 'pending_acceptance',
      paymentStatus: 'paid',
      fulfillmentStatus: 'preparing',
    };

    beforeEach(() => {
      prismaService.scanOrderPaymentAttempt.findUnique.mockResolvedValue(
        attemptData,
      );
      prismaService.scanOrders.findUnique
        .mockResolvedValueOnce(orderPending) // 事务内
        .mockResolvedValueOnce(orderPaid); // 事务后
    });

    it('ScanOrderPaymentAttempt.status = succeeded', async () => {
      await service.confirmOrderPaidByCallback(
        'SO20260723120000ABCD-1A2B3C4D',
        baseSettlement,
      );

      expect(prismaService.scanOrderPaymentAttempt.update).toHaveBeenCalledWith(
        {
          where: { id: 801 },
          data: {
            status: 'succeeded',
            providerTransactionId: '4200001234202606101234567890',
            paidAt: expect.any(Date),
          },
        },
      );
    });

    it('订单 status = pending_acceptance, paymentStatus = paid, paidAmount = 回调金额', async () => {
      await service.confirmOrderPaidByCallback(
        'SO20260723120000ABCD-1A2B3C4D',
        baseSettlement,
      );

      expect(prismaService.scanOrders.update).toHaveBeenCalledWith({
        where: { id: 1001 },
        data: {
          status: 'pending_acceptance',
          paymentStatus: 'paid',
          paidAmount: 5000,
          paidAt: expect.any(Date),
          version: { increment: 1 },
        },
      });
    });

    it('写入状态历史', async () => {
      await service.confirmOrderPaidByCallback(
        'SO20260723120000ABCD-1A2B3C4D',
        baseSettlement,
      );

      expect(prismaService.scanOrderStatusHistory.create).toHaveBeenCalledWith({
        data: {
          orderId: 1001,
          storeId: 11,
          fromStatus: 'pending_payment',
          toStatus: 'pending_acceptance',
          operatorType: 'payment_callback',
          reason: expect.stringContaining('4200001234202606101234567890'),
        },
      });
    });

    it('发布 order.status_changed', async () => {
      await service.confirmOrderPaidByCallback(
        'SO20260723120000ABCD-1A2B3C4D',
        baseSettlement,
      );

      expect(realtimeService.publishOrderStatusChanged).toHaveBeenCalledWith({
        orderId: 1001,
        storeId: 11,
        sessionId: 55,
        status: 'pending_acceptance',
        paymentStatus: 'paid',
        fulfillmentStatus: 'preparing',
        pickupNumber: undefined,
        pickupNumberLabel: undefined,
        pickupNumberStatus: undefined,
        pickupCalledAt: null,
        pickupCompletedAt: null,
      });
    });

    it('支付成功后不再调用标准销售桥接（销售记录在商家出餐时创建）', async () => {
      await service.confirmOrderPaidByCallback(
        'SO20260723120000ABCD-1A2B3C4D',
        baseSettlement,
      );

      expect(saleOrderBridgeService.createForPaidOrder).not.toHaveBeenCalled();
    });

    it('重复回调保持幂等', async () => {
      await service.confirmOrderPaidByCallback(
        'SO20260723120000ABCD-1A2B3C4D',
        baseSettlement,
      );

      const firstHistoryCallCount =
        prismaService.scanOrderStatusHistory.create.mock.calls.length;
      const firstUpdateCallCount =
        prismaService.scanOrders.update.mock.calls.length;
      const firstBridgeCallCount =
        saleOrderBridgeService.createForPaidOrder.mock.calls.length;

      // 第二次回调：订单已经是 paid + succeeded 状态
      prismaService.scanOrderPaymentAttempt.findUnique.mockResolvedValue({
        id: 801,
        orderId: 1001,
        amount: 5000,
        status: 'succeeded',
      });
      // 事务内和事务后都返回已支付订单
      prismaService.scanOrders.findUnique.mockResolvedValue({
        id: 1001,
        storeId: 11,
        sessionId: 55,
        orderNo: 'SO20260723120000ABCD',
        status: 'pending_acceptance',
        paymentStatus: 'paid',
        fulfillmentStatus: 'preparing',
        payableAmount: 5000,
        paidAmount: 5000,
        version: 2,
      });

      const result = await service.confirmOrderPaidByCallback(
        'SO20260723120000ABCD-1A2B3C4D',
        baseSettlement,
      );

      expect(result).toEqual({
        orderNo: 'SO20260723120000ABCD',
        orderType: 'scan_ordering',
        status: 'pending_acceptance',
      });

      // 不应该重复写历史或更新订单
      expect(prismaService.scanOrderStatusHistory.create).toHaveBeenCalledTimes(
        firstHistoryCallCount,
      );
      expect(prismaService.scanOrders.update).toHaveBeenCalledTimes(
        firstUpdateCallCount,
      );
      // 已支付订单重复回调：幂等提前返回，不重复触发桥接
      expect(saleOrderBridgeService.createForPaidOrder).toHaveBeenCalledTimes(
        firstBridgeCallCount,
      );
    });

    it('数据库事务提交之前不发布 order.status_changed', async () => {
      let resolveTx!: (value: unknown) => void;
      prismaService.$transaction = jest.fn(
        () =>
          new Promise((resolve) => {
            resolveTx = resolve;
          }),
      );
      // 事务回调未执行，事务后重新查询订单返回已支付状态
      prismaService.scanOrders.findUnique
        .mockReset()
        .mockResolvedValue(orderPaid);

      const confirmPromise = service.confirmOrderPaidByCallback(
        'SO20260723120000ABCD-1A2B3C4D',
        baseSettlement,
      );
      // 事务仍在等待提交（等待内部多个 await 走到 $transaction）
      await new Promise((resolve) => setImmediate(resolve));
      expect(realtimeService.publishOrderStatusChanged).not.toHaveBeenCalled();

      // 事务提交完成
      resolveTx({
        orderNo: 'SO20260723120000ABCD',
        orderType: 'scan_ordering',
        status: 'pending_acceptance',
      });
      await confirmPromise;

      expect(realtimeService.publishOrderStatusChanged).toHaveBeenCalledTimes(
        1,
      );
      expect(realtimeService.publishOrderStatusChanged).toHaveBeenCalledWith(
        expect.objectContaining({
          orderId: 1001,
          storeId: 11,
          sessionId: 55,
          status: 'pending_acceptance',
          paymentStatus: 'paid',
          fulfillmentStatus: 'preparing',
        }),
      );
    });
  });

  // ── 4.2 回调金额不一致 ────────────────────────────────────

  describe('4.2 回调金额不一致', () => {
    beforeEach(() => {
      prismaService.scanOrderPaymentAttempt.findUnique.mockResolvedValue({
        id: 802,
        orderId: 1002,
        amount: 5000,
        status: 'paying',
      });
    });

    it('抛出 ConflictException', async () => {
      await expect(
        service.confirmOrderPaidByCallback('SO20260723120000ABCD-EFGH5678', {
          ...baseSettlement,
          amountFen: 4999,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('不修改支付尝试', async () => {
      try {
        await service.confirmOrderPaidByCallback(
          'SO20260723120000ABCD-EFGH5678',
          { ...baseSettlement, amountFen: 4999 },
        );
      } catch {
        // expected
      }
      expect(paymentLockService.withOrderLock).not.toHaveBeenCalled();
    });

    it('不修改订单', async () => {
      try {
        await service.confirmOrderPaidByCallback(
          'SO20260723120000ABCD-EFGH5678',
          { ...baseSettlement, amountFen: 4999 },
        );
      } catch {
        // expected
      }
      expect(prismaService.$transaction).not.toHaveBeenCalled();
    });

    it('不写历史', async () => {
      try {
        await service.confirmOrderPaidByCallback(
          'SO20260723120000ABCD-EFGH5678',
          { ...baseSettlement, amountFen: 4999 },
        );
      } catch {
        // expected
      }
      expect(
        prismaService.scanOrderStatusHistory.create,
      ).not.toHaveBeenCalled();
    });

    it('不发实时事件', async () => {
      try {
        await service.confirmOrderPaidByCallback(
          'SO20260723120000ABCD-EFGH5678',
          { ...baseSettlement, amountFen: 4999 },
        );
      } catch {
        // expected
      }
      expect(realtimeService.publishOrderStatusChanged).not.toHaveBeenCalled();
    });
  });

  // ── 4.3 订单已超时关闭后收到成功回调 ──────────────────────

  describe('4.3 订单已超时关闭后收到成功回调', () => {
    const cancelledOrder = {
      id: 2001,
      storeId: 11,
      sessionId: 60,
      orderNo: 'SO20260723130000WXYZ',
      status: 'cancelled',
      paymentStatus: 'unpaid',
      fulfillmentStatus: 'closed',
      payableAmount: 5000,
      paidAmount: 0,
      version: 2,
      cancelReason: '支付超时关闭',
    };

    beforeEach(() => {
      prismaService.scanOrderPaymentAttempt.findUnique.mockResolvedValue({
        id: 803,
        orderId: 2001,
        amount: 5000,
        status: 'closed',
      });
      // 事务内查找返回 cancelled 订单，事务后查找返回 cancelledOrder（用于获取 orderNo）
      prismaService.scanOrders.findUnique
        .mockResolvedValueOnce(cancelledOrder) // 事务内
        .mockResolvedValueOnce(cancelledOrder); // 事务后（异常支付路径）
    });

    it('不恢复订单为 pending_acceptance', async () => {
      await service.confirmOrderPaidByCallback(
        'SO20260723130000WXYZ-ABCD1234',
        baseSettlement,
      );
      // scanOrders.update 只在正常支付路径调用，异常支付不调用
      expect(prismaService.scanOrders.update).not.toHaveBeenCalled();
    });

    it('不修改为 paid', async () => {
      await service.confirmOrderPaidByCallback(
        'SO20260723130000WXYZ-ABCD1234',
        baseSettlement,
      );
      expect(prismaService.scanOrders.update).not.toHaveBeenCalled();
    });

    it('不再次扣减库存（不调用 scanOrders.update）', async () => {
      await service.confirmOrderPaidByCallback(
        'SO20260723130000WXYZ-ABCD1234',
        baseSettlement,
      );
      expect(prismaService.scanOrders.update).not.toHaveBeenCalled();
    });

    it('记录高优先级日志，包含 orderId、merchantPaymentNo、transactionId', async () => {
      await service.confirmOrderPaidByCallback(
        'SO20260723130000WXYZ-ABCD1234',
        baseSettlement,
      );

      expect(loggerErrorSpy).toHaveBeenCalled();
      const logMessage = loggerErrorSpy!.mock.calls[0][0];
      expect(logMessage).toContain('orderId=2001');
      expect(logMessage).toContain(
        'merchantPaymentNo=SO20260723130000WXYZ-ABCD1234',
      );
      expect(logMessage).toContain(
        'transactionId=4200001234202606101234567890',
      );
    });

    it('创建退款任务（退款处置可追踪）', async () => {
      await service.confirmOrderPaidByCallback(
        'SO20260723130000WXYZ-ABCD1234',
        baseSettlement,
      );

      expect(refundService.createRefundTaskInTransaction).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          orderId: 2001,
          storeId: 11,
          triggerType: 'anomalous_payment',
          refundAmount: 5000,
          merchantPaymentNo: 'SO20260723130000WXYZ-ABCD1234',
          providerTransactionId: '4200001234202606101234567890',
        }),
      );
    });

    it('写入异常支付状态历史', async () => {
      await service.confirmOrderPaidByCallback(
        'SO20260723130000WXYZ-ABCD1234',
        baseSettlement,
      );

      expect(prismaService.scanOrderStatusHistory.create).toHaveBeenCalledWith({
        data: {
          orderId: 2001,
          storeId: 11,
          fromStatus: 'cancelled',
          toStatus: 'cancelled',
          operatorType: 'payment_callback',
          reason: expect.stringContaining('异常支付回调'),
        },
      });
    });

    it('支付尝试更新为 succeeded 并记录回调数据', async () => {
      await service.confirmOrderPaidByCallback(
        'SO20260723130000WXYZ-ABCD1234',
        baseSettlement,
      );

      expect(prismaService.scanOrderPaymentAttempt.update).toHaveBeenCalledWith(
        {
          where: { id: 803 },
          data: {
            status: 'succeeded',
            providerTransactionId: '4200001234202606101234567890',
            paidAt: expect.any(Date),
            callbackPayload: expect.objectContaining({
              anomalous: true,
              transactionId: '4200001234202606101234567890',
              amountFen: 5000,
            }),
          },
        },
      );
    });

    it('按微信回调协议返回成功确认（不抛异常）', async () => {
      const result = await service.confirmOrderPaidByCallback(
        'SO20260723130000WXYZ-ABCD1234',
        baseSettlement,
      );

      expect(result).toEqual({
        orderNo: 'SO20260723130000WXYZ',
        orderType: 'scan_ordering',
        status: 'pending_acceptance',
      });
    });

    it('不向商家端发送错误的待接单事件', async () => {
      await service.confirmOrderPaidByCallback(
        'SO20260723130000WXYZ-ABCD1234',
        baseSettlement,
      );
      expect(realtimeService.publishOrderStatusChanged).not.toHaveBeenCalled();
    });
  });

  // ── 4.4 用户取消后收到成功回调 ────────────────────────────

  describe('4.4 用户取消后收到成功回调', () => {
    const cancelledOrder = {
      id: 3001,
      storeId: 11,
      sessionId: 70,
      orderNo: 'SO20260723140000PQRS',
      status: 'cancelled',
      paymentStatus: 'unpaid',
      fulfillmentStatus: 'closed',
      payableAmount: 5000,
      paidAmount: 0,
      version: 2,
      cancelReason: '用户取消',
    };

    beforeEach(() => {
      prismaService.scanOrderPaymentAttempt.findUnique.mockResolvedValue({
        id: 804,
        orderId: 3001,
        amount: 5000,
        status: 'closed',
      });
      prismaService.scanOrders.findUnique
        .mockResolvedValueOnce(cancelledOrder)
        .mockResolvedValueOnce(cancelledOrder);
    });

    it('不得改回已支付', async () => {
      await service.confirmOrderPaidByCallback(
        'SO20260723140000PQRS-EFGH9012',
        baseSettlement,
      );

      expect(prismaService.scanOrders.update).not.toHaveBeenCalled();
    });

    it('不得恢复库存占用', async () => {
      await service.confirmOrderPaidByCallback(
        'SO20260723140000PQRS-EFGH9012',
        baseSettlement,
      );
      expect(prismaService.scanOrders.update).not.toHaveBeenCalled();
    });

    it('必须可追踪退款处置（高优先级日志）', async () => {
      await service.confirmOrderPaidByCallback(
        'SO20260723140000PQRS-EFGH9012',
        baseSettlement,
      );

      expect(loggerErrorSpy).toHaveBeenCalled();
      const logMessage = loggerErrorSpy!.mock.calls[0][0];
      expect(logMessage).toContain('orderId=3001');
      expect(logMessage).toContain(
        'merchantPaymentNo=SO20260723140000PQRS-EFGH9012',
      );
      expect(logMessage).toContain(
        'transactionId=4200001234202606101234567890',
      );
    });

    it('创建退款任务', async () => {
      await service.confirmOrderPaidByCallback(
        'SO20260723140000PQRS-EFGH9012',
        baseSettlement,
      );

      expect(refundService.createRefundTaskInTransaction).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          orderId: 3001,
          triggerType: 'anomalous_payment',
          refundAmount: 5000,
        }),
      );
    });
  });

  // ── 辅助场景 ──────────────────────────────────────────────

  describe('辅助场景', () => {
    it('支付流水不存在时抛出 NotFoundException', async () => {
      prismaService.scanOrderPaymentAttempt.findUnique.mockResolvedValue(null);

      await expect(
        service.confirmOrderPaidByCallback('NOTEXIST-1234', baseSettlement),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('订单状态不允许确认支付（非 cancelled 但也不是 pending_payment）时抛出 ConflictException', async () => {
      prismaService.scanOrderPaymentAttempt.findUnique.mockResolvedValue({
        id: 805,
        orderId: 4001,
        amount: 5000,
        status: 'paying',
      });
      prismaService.scanOrders.findUnique.mockResolvedValue({
        id: 4001,
        storeId: 11,
        sessionId: 90,
        orderNo: 'SO20260723150000LMNO',
        status: 'preparing',
        paymentStatus: 'paid',
        fulfillmentStatus: 'preparing',
        payableAmount: 5000,
        paidAmount: 5000,
        version: 3,
      });

      await expect(
        service.confirmOrderPaidByCallback(
          'SO20260723150000LMNO-ABCD3456',
          baseSettlement,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
