import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { ScanOrderingRealtimeService } from '../../../purely-club/scan-ordering/scan-ordering-realtime.service';
import { ScanOrderingRefundService } from '../../../purely-club/scan-ordering/scan-ordering-refund.service';
import { SalesRecordRefundService } from '../sales-record/sales-record-refund.service';
import { ScanOrderingOrderRefundBalanceService } from './scan-ordering-order-refund-balance.service';
import { ScanOrderingRefundStockRestoreService } from './scan-ordering-refund-stock-restore.service';
import { ScanOrderingOrderRefundHandlingService } from './scan-ordering-order-refund.service';
import { ClubWechatRefundService } from '../../../purely-club/payments/club-wechat-refund.service';

describe('ScanOrderingOrderRefundHandlingService.completeRefund', () => {
  let service: ScanOrderingOrderRefundHandlingService;

  const prismaService = {
    $transaction: jest.fn(),
    scanOrders: {
      findFirst: jest.fn(),
      updateMany: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
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
    saleOrder: {
      findUnique: jest.fn(),
    },
  };

  const commerceAccessService = {
    resolveSingleStoreId: jest.fn(),
  };

  const realtimeService = {
    publishOrderStatusChanged: jest.fn(),
  };

  const refundService = {
    markRefundTaskSucceededInTransaction: jest.fn(),
    createRefundTask: jest.fn(),
    createRefundTaskInTransaction: jest.fn(),
  };

  const balanceRefundService = {
    refund: jest.fn(),
  };

  const salesRecordRefundService = {
    refundInTransaction: jest.fn(),
  };

  const stockRestoreService = {
    restoreReservedStock: jest.fn(),
    refundSaleOrder: jest.fn(),
  };

  const configService = {
    get: jest.fn(),
  };

  const wechatRefundService = {
    requestRefund: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    prismaService.$transaction.mockImplementation(
      async (callback: (tx: typeof prismaService) => Promise<unknown>) =>
        callback(prismaService),
    );
    commerceAccessService.resolveSingleStoreId.mockResolvedValue(11);
    realtimeService.publishOrderStatusChanged.mockResolvedValue(undefined);
    refundService.markRefundTaskSucceededInTransaction.mockResolvedValue(
      undefined,
    );
    salesRecordRefundService.refundInTransaction.mockResolvedValue(undefined);
    stockRestoreService.restoreReservedStock.mockResolvedValue(undefined);
    stockRestoreService.refundSaleOrder.mockResolvedValue(undefined);
    prismaService.scanOrderStatusHistory.create.mockResolvedValue({});
    prismaService.scanOrderPaymentAttempt.updateMany.mockResolvedValue({
      count: 1,
    });
    prismaService.scanOrderCouponUsage.updateMany.mockResolvedValue({
      count: 0,
    });
    prismaService.scanOrderItem.findMany.mockResolvedValue([]);
    prismaService.scanOrders.findUniqueOrThrow.mockResolvedValue({
      id: 1001,
      storeId: 11,
    });
    prismaService.scanOrders.findUnique.mockResolvedValue({
      id: 1001,
      storeId: 11,
      sessionId: 55,
      status: 'rejected',
      paymentStatus: 'refunded',
      fulfillmentStatus: 'closed',
      refundTasks: [],
    });
    configService.get.mockReturnValue('development');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScanOrderingOrderRefundHandlingService,
        { provide: PrismaService, useValue: prismaService },
        { provide: CommerceAccessService, useValue: commerceAccessService },
        { provide: ScanOrderingRealtimeService, useValue: realtimeService },
        { provide: ScanOrderingRefundService, useValue: refundService },
        {
          provide: ScanOrderingOrderRefundBalanceService,
          useValue: balanceRefundService,
        },
        {
          provide: SalesRecordRefundService,
          useValue: salesRecordRefundService,
        },
        {
          provide: ScanOrderingRefundStockRestoreService,
          useValue: stockRestoreService,
        },
        { provide: ConfigService, useValue: configService },
        { provide: ClubWechatRefundService, useValue: wechatRefundService },
      ],
    }).compile();

    service = module.get<ScanOrderingOrderRefundHandlingService>(
      ScanOrderingOrderRefundHandlingService,
    );
  });

  it('普通退款完成确认：订单置为 rejected/refunded/closed 并版本加一', async () => {
    prismaService.scanOrders.updateMany.mockResolvedValueOnce({ count: 1 });

    await service.completeRefund({ id: 1, name: '收银员' } as never, 1001, 2, {
      refundNo: 'RF20260803001',
      refundId: 'wx-refund-123',
    });

    expect(prismaService.scanOrders.updateMany).toHaveBeenCalledWith({
      where: {
        id: 1001,
        storeId: 11,
        version: 2,
        status: 'refunding',
        paymentStatus: 'refunding',
      },
      data: {
        status: 'rejected',
        paymentStatus: 'refunded',
        fulfillmentStatus: 'closed',
        version: { increment: 1 },
      },
    });
  });

  it('普通退款完成确认：委托库存恢复与销售冲销服务各一次', async () => {
    prismaService.scanOrders.updateMany.mockResolvedValueOnce({ count: 1 });

    await service.completeRefund({ id: 1, name: '收银员' } as never, 1001, 2);

    expect(stockRestoreService.restoreReservedStock).toHaveBeenCalledTimes(1);
    expect(stockRestoreService.refundSaleOrder).toHaveBeenCalledTimes(1);
  });

  it('普通退款完成确认：只创建一次标准销售退款与财务退款', async () => {
    prismaService.scanOrders.updateMany.mockResolvedValueOnce({ count: 1 });
    prismaService.saleOrder.findUnique.mockResolvedValue({ id: 500 });

    await service.completeRefund({ id: 1, name: '收银员' } as never, 1001, 2);

    expect(stockRestoreService.refundSaleOrder).toHaveBeenCalledTimes(1);
  });

  it('普通退款完成确认：无标准销售单时仍委托销售冲销服务（内部跳过）', async () => {
    prismaService.scanOrders.updateMany.mockResolvedValueOnce({ count: 1 });
    prismaService.saleOrder.findUnique.mockResolvedValue(null);

    await service.completeRefund({ id: 1, name: '收银员' } as never, 1001, 2);

    expect(stockRestoreService.refundSaleOrder).toHaveBeenCalledTimes(1);
  });

  it('普通退款完成确认：已 refunded 的订单重复确认抛 ConflictException 且不恢复库存', async () => {
    prismaService.scanOrders.updateMany.mockResolvedValueOnce({ count: 0 });
    prismaService.scanOrders.findFirst.mockResolvedValue({
      id: 1001,
      status: 'rejected',
      paymentStatus: 'refunded',
    });

    await expect(
      service.completeRefund({ id: 1, name: '收银员' } as never, 1001, 3),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prismaService.scanOrderItem.findMany).not.toHaveBeenCalled();
    expect(stockRestoreService.restoreReservedStock).not.toHaveBeenCalled();
    expect(stockRestoreService.refundSaleOrder).not.toHaveBeenCalled();
  });

  // ─── autoRefundByTimeout：系统超时自动退款 ───────────────────

  it('系统超时退款：手工补录单直接跳过，不发起任何退款', async () => {
    prismaService.scanOrders.findFirst.mockResolvedValue({
      id: 1001,
      storeId: 11,
      paymentStatus: 'paid',
      paidAmount: 2500,
      manualEntry: true,
      paymentAttempts: [],
    });

    await service.autoRefundByTimeout({
      orderId: 1001,
      storeId: 11,
      version: 2,
      fromStatus: 'pending_acceptance',
      reason: '商家超时未接单，系统自动退款',
    });

    expect(prismaService.scanOrders.updateMany).not.toHaveBeenCalled();
    expect(balanceRefundService.refund).not.toHaveBeenCalled();
    expect(refundService.createRefundTask).not.toHaveBeenCalled();
    expect(wechatRefundService.requestRefund).not.toHaveBeenCalled();
  });

  it('系统超时退款：未支付订单直接置拒绝并释放预留库存', async () => {
    prismaService.scanOrders.findFirst.mockResolvedValue({
      id: 1001,
      storeId: 11,
      paymentStatus: 'unpaid',
      paidAmount: 0,
      manualEntry: false,
      paymentAttempts: [],
    });
    prismaService.scanOrders.updateMany.mockResolvedValue({ count: 1 });

    await service.autoRefundByTimeout({
      orderId: 1001,
      storeId: 11,
      version: 2,
      fromStatus: 'pending_acceptance',
      reason: '商家超时未接单，系统自动退款',
    });

    expect(prismaService.scanOrders.updateMany).toHaveBeenCalledWith({
      where: {
        id: 1001,
        storeId: 11,
        version: 2,
        status: 'pending_acceptance',
      },
      data: {
        status: 'rejected',
        fulfillmentStatus: 'closed',
        version: { increment: 1 },
        rejectReason: '商家超时未接单，系统自动退款',
      },
    });
    expect(stockRestoreService.restoreReservedStock).toHaveBeenCalledTimes(1);
  });

  it('系统超时退款：余额支付原路退回余额并推送完成事件', async () => {
    prismaService.scanOrders.findFirst.mockResolvedValue({
      id: 1001,
      storeId: 11,
      paymentStatus: 'paid',
      paidAmount: 2500,
      manualEntry: false,
      paymentAttempts: [
        {
          id: 801,
          paymentChannel: 'marketing_balance',
          merchantPaymentNo: null,
          providerTransactionId: null,
        },
      ],
    });
    balanceRefundService.refund.mockResolvedValue({
      id: 1001,
      storeId: 11,
      sessionId: 55,
      status: 'rejected',
      paymentStatus: 'refunded',
      fulfillmentStatus: 'closed',
      pickupNumber: 5,
      refundTasks: [],
    });

    await service.autoRefundByTimeout({
      orderId: 1001,
      storeId: 11,
      version: 2,
      fromStatus: 'pending_acceptance',
      reason: '商家超时未接单，系统自动退款',
    });

    expect(balanceRefundService.refund).toHaveBeenCalledWith(
      {
        orderId: 1001,
        storeId: 11,
        version: 2,
        reason: '商家超时未接单，系统自动退款',
        fromStatus: 'pending_acceptance',
      },
      expect.objectContaining({ id: 0 }),
      'system',
    );
    expect(realtimeService.publishOrderStatusChanged).toHaveBeenCalled();
  });

  it('系统超时退款：制作中微信订单自动调微信退款 API 并完成闭环', async () => {
    prismaService.scanOrders.findFirst.mockResolvedValue({
      id: 1001,
      storeId: 11,
      paymentStatus: 'paid',
      paidAmount: 2500,
      manualEntry: false,
      paymentAttempts: [
        {
          id: 801,
          paymentChannel: 'wechat_jsapi',
          merchantPaymentNo: 'SO123-WX1A2B',
          providerTransactionId: 'txn-123',
        },
      ],
    });
    prismaService.scanOrders.updateMany.mockResolvedValue({ count: 1 });
    refundService.createRefundTask.mockResolvedValue('SR20260819001');
    wechatRefundService.requestRefund.mockResolvedValue({
      refundId: 'wx-refund-001',
    });

    await service.autoRefundByTimeout({
      orderId: 1001,
      storeId: 11,
      version: 2,
      fromStatus: 'preparing',
      reason: '商家超时未出餐，系统自动退款',
    });

    // 置退款中的乐观锁条件必须匹配 preparing 源状态
    expect(prismaService.scanOrders.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        id: 1001,
        storeId: 11,
        version: 2,
        status: 'preparing',
      },
      data: {
        status: 'refunding',
        paymentStatus: 'refunding',
        rejectReason: '商家超时未出餐，系统自动退款',
        version: { increment: 1 },
      },
    });
    // 退款任务标记为系统超时触发
    expect(refundService.createRefundTask).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerType: 'system_timeout',
        operatorType: 'system',
        merchantPaymentNo: 'SO123-WX1A2B',
        refundAmount: 2500,
      }),
    );
    // 微信退款 API：out_trade_no 传商户支付单号
    expect(wechatRefundService.requestRefund).toHaveBeenCalledWith({
      storeId: 11,
      orderNo: 'SO123-WX1A2B',
      refundNo: 'SR20260819001',
      totalFen: 2500,
      refundFen: 2500,
      reason: '商家超时未出餐，系统自动退款',
    });
    // 闭环：库存恢复 + 销售冲销 + 退款任务标记成功 + 实时推送
    expect(stockRestoreService.restoreReservedStock).toHaveBeenCalledTimes(1);
    expect(
      refundService.markRefundTaskSucceededInTransaction,
    ).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        providerRefundId: 'wx-refund-001',
      }),
    );
    expect(realtimeService.publishOrderStatusChanged).toHaveBeenCalled();
  });

  it('系统超时退款：微信 API 调用失败时保留人工待处理任务兜底', async () => {
    prismaService.scanOrders.findFirst.mockResolvedValue({
      id: 1001,
      storeId: 11,
      paymentStatus: 'paid',
      paidAmount: 2500,
      manualEntry: false,
      paymentAttempts: [
        {
          id: 801,
          paymentChannel: 'wechat_jsapi',
          merchantPaymentNo: 'SO123-WX1A2B',
          providerTransactionId: 'txn-123',
        },
      ],
    });
    prismaService.scanOrders.updateMany.mockResolvedValue({ count: 1 });
    refundService.createRefundTask.mockResolvedValue('SR20260819002');
    wechatRefundService.requestRefund.mockRejectedValue(
      new Error('微信退款服务暂时不可用，请稍后重试'),
    );

    await expect(
      service.autoRefundByTimeout({
        orderId: 1001,
        storeId: 11,
        version: 2,
        fromStatus: 'pending_acceptance',
        reason: '商家超时未接单，系统自动退款',
      }),
    ).rejects.toThrow('微信退款服务暂时不可用');

    // 任务已创建（manual_pending），订单停留在 refunding，供商家端人工确认兜底
    expect(refundService.createRefundTask).toHaveBeenCalledTimes(1);
    expect(
      refundService.markRefundTaskSucceededInTransaction,
    ).not.toHaveBeenCalled();
  });

  it('系统超时退款：订单不存在时直接返回不处理', async () => {
    prismaService.scanOrders.findFirst.mockResolvedValue(null);

    await service.autoRefundByTimeout({
      orderId: 9999,
      storeId: 11,
      version: 1,
      fromStatus: 'pending_acceptance',
      reason: '商家超时未接单，系统自动退款',
    });

    expect(prismaService.scanOrders.updateMany).not.toHaveBeenCalled();
    expect(balanceRefundService.refund).not.toHaveBeenCalled();
  });

  // ─── autoCloseManualEntryByTimeout：手工单超时关闭 ──────────

  it('手工单待接单超时：置拒绝并记账，不触发任何真实退款', async () => {
    prismaService.scanOrders.findFirst.mockResolvedValue({ id: 1001 });
    prismaService.scanOrders.updateMany.mockResolvedValue({ count: 1 });

    await service.autoCloseManualEntryByTimeout({
      orderId: 1001,
      storeId: 11,
      version: 2,
      fromStatus: 'pending_acceptance',
      reason: '商家超时未接单，系统自动退款',
    });

    // 查询限定手工单 + 源状态
    expect(prismaService.scanOrders.findFirst).toHaveBeenCalledWith({
      where: {
        id: 1001,
        storeId: 11,
        status: 'pending_acceptance',
        manualEntry: true,
      },
      select: { id: true },
    });
    // 状态置拒绝 + 释放库存 + 记账
    expect(prismaService.scanOrders.updateMany).toHaveBeenCalledWith({
      where: {
        id: 1001,
        storeId: 11,
        status: 'pending_acceptance',
        version: 2,
      },
      data: {
        status: 'rejected',
        fulfillmentStatus: 'closed',
        version: { increment: 1 },
        rejectReason: expect.stringContaining('商家超时未接单，系统自动退款'),
      },
    });
    expect(stockRestoreService.restoreReservedStock).toHaveBeenCalledTimes(1);
    expect(stockRestoreService.refundSaleOrder).toHaveBeenCalledTimes(1);
    // 不触发真实退款
    expect(balanceRefundService.refund).not.toHaveBeenCalled();
    expect(refundService.createRefundTask).not.toHaveBeenCalled();
    expect(wechatRefundService.requestRefund).not.toHaveBeenCalled();
    // 状态历史标记系统操作
    expect(prismaService.scanOrderStatusHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        fromStatus: 'pending_acceptance',
        toStatus: 'rejected',
        operatorType: 'system',
      }),
    });
    // 推送状态变更
    expect(realtimeService.publishOrderStatusChanged).toHaveBeenCalled();
  });

  it('手工单制作中超时：按 preparing 源状态关闭', async () => {
    prismaService.scanOrders.findFirst.mockResolvedValue({ id: 1001 });
    prismaService.scanOrders.updateMany.mockResolvedValue({ count: 1 });

    await service.autoCloseManualEntryByTimeout({
      orderId: 1001,
      storeId: 11,
      version: 3,
      fromStatus: 'preparing',
      reason: '商家超时未出餐，系统自动退款',
    });

    expect(prismaService.scanOrders.findFirst).toHaveBeenCalledWith({
      where: {
        id: 1001,
        storeId: 11,
        status: 'preparing',
        manualEntry: true,
      },
      select: { id: true },
    });
    expect(prismaService.scanOrders.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1001, storeId: 11, status: 'preparing', version: 3 },
      }),
    );
  });

  it('手工单超时：订单不存在时直接返回不处理', async () => {
    prismaService.scanOrders.findFirst.mockResolvedValue(null);

    await service.autoCloseManualEntryByTimeout({
      orderId: 9999,
      storeId: 11,
      version: 1,
      fromStatus: 'pending_acceptance',
      reason: '商家超时未接单，系统自动退款',
    });

    expect(prismaService.scanOrders.updateMany).not.toHaveBeenCalled();
    expect(stockRestoreService.restoreReservedStock).not.toHaveBeenCalled();
  });
});
