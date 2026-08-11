import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { SalesRecordRefundService } from '../sales-record/sales-record-refund.service';
import { ScanOrderingRefundService } from '../../../purely-club/scan-ordering/scan-ordering-refund.service';
import { ScanOrderingOrderRefundBalanceService } from './scan-ordering-order-refund-balance.service';

describe('ScanOrderingOrderRefundBalanceService', () => {
  let service: ScanOrderingOrderRefundBalanceService;

  const prismaService = {
    $transaction: jest.fn(),
    scanOrderBalanceTransaction: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    scanOrders: {
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
    marketingCustomer: {
      update: jest.fn(),
      findUnique: jest.fn(),
    },
    marketingPointsRecord: {
      create: jest.fn(),
    },
    scanOrderPaymentAttempt: {
      findFirst: jest.fn(),
      updateMany: jest.fn(),
    },
    scanOrderRefundTask: {
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

  const refundService = {
    createRefundTaskInTransaction: jest.fn(),
    markRefundTaskSucceededInTransaction: jest.fn(),
  };

  const salesRecordRefundService = {
    refundInTransaction: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    prismaService.$transaction.mockImplementation(
      async (callback: (tx: typeof prismaService) => Promise<unknown>) =>
        callback(prismaService),
    );
    prismaService.scanOrderBalanceTransaction.findUnique.mockResolvedValue({
      customerId: 55,
      amount: 2000,
    });
    prismaService.scanOrders.updateMany.mockResolvedValue({ count: 1 });
    prismaService.scanOrderBalanceTransaction.create.mockResolvedValue({});
    prismaService.marketingCustomer.update.mockResolvedValue({});
    prismaService.marketingCustomer.findUnique.mockResolvedValue({
      points: 100,
    });
    prismaService.scanOrderPaymentAttempt.findFirst.mockResolvedValue(null);
    prismaService.scanOrderPaymentAttempt.updateMany.mockResolvedValue({
      count: 0,
    });
    prismaService.scanOrderRefundTask.updateMany.mockResolvedValue({
      count: 0,
    });
    prismaService.scanOrderCouponUsage.updateMany.mockResolvedValue({
      count: 0,
    });
    prismaService.scanOrderStatusHistory.create.mockResolvedValue({});
    prismaService.scanOrderItem.findMany.mockResolvedValue([]);
    prismaService.scanOrderingMenuProduct.updateMany.mockResolvedValue({
      count: 0,
    });
    prismaService.scanOrderingSpecOption.updateMany.mockResolvedValue({
      count: 0,
    });
    prismaService.product.updateMany.mockResolvedValue({ count: 0 });
    prismaService.saleOrder.findUnique.mockResolvedValue(null);
    prismaService.scanOrders.findUnique.mockResolvedValue({
      marketingSnapshot: {
        pointsUsed: 0,
        pointsSettlementStatus: 'settled',
      },
    });
    prismaService.scanOrders.findUniqueOrThrow.mockResolvedValue({
      id: 1001,
      storeId: 11,
      sessionId: 55,
      status: 'rejected',
      paymentStatus: 'refunded',
      fulfillmentStatus: 'closed',
      refundTasks: [],
    });
    refundService.createRefundTaskInTransaction.mockResolvedValue(undefined);
    refundService.markRefundTaskSucceededInTransaction.mockResolvedValue(
      undefined,
    );
    salesRecordRefundService.refundInTransaction.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScanOrderingOrderRefundBalanceService,
        { provide: PrismaService, useValue: prismaService },
        { provide: ScanOrderingRefundService, useValue: refundService },
        {
          provide: SalesRecordRefundService,
          useValue: salesRecordRefundService,
        },
      ],
    }).compile();

    service = module.get<ScanOrderingOrderRefundBalanceService>(
      ScanOrderingOrderRefundBalanceService,
    );
  });

  it('余额退款：订单置为 rejected/refunded/closed 并版本加一', async () => {
    await service.refund(
      { orderId: 1001, storeId: 11, version: 1, reason: '顾客申请' },
      201,
    );

    expect(prismaService.scanOrders.updateMany).toHaveBeenCalledWith({
      where: {
        id: 1001,
        storeId: 11,
        version: 1,
        status: 'pending_acceptance',
        paymentStatus: 'paid',
      },
      data: {
        status: 'rejected',
        paymentStatus: 'refunded',
        fulfillmentStatus: 'closed',
        rejectReason: '顾客申请',
        version: { increment: 1 },
      },
    });
  });

  it('余额退款：回补会员余额并写入 refund 流水', async () => {
    await service.refund(
      { orderId: 1001, storeId: 11, version: 1, reason: '顾客申请' },
      201,
    );

    expect(prismaService.marketingCustomer.update).toHaveBeenCalledWith({
      where: { id: 55 },
      data: { balance: { increment: 2000 } },
    });
    expect(
      prismaService.scanOrderBalanceTransaction.create,
    ).toHaveBeenCalledWith({
      data: {
        orderId: 1001,
        customerId: 55,
        amount: 2000,
        type: 'refund',
      },
    });
  });

  it('余额退款：恢复菜单商品库存、共用 Product.stock 与规格库存一次', async () => {
    prismaService.scanOrderItem.findMany.mockResolvedValue([
      {
        menuProductId: 201,
        quantity: 2,
        menuProduct: { productId: 901 },
        specs: [{ specOptionId: 301 }, { specOptionId: 302 }],
      },
    ]);

    await service.refund(
      { orderId: 1001, storeId: 11, version: 1, reason: '顾客申请' },
      201,
    );

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
    expect(prismaService.product.updateMany).toHaveBeenCalledWith({
      where: { id: 901, storeId: 11, deletedAt: null },
      data: { stock: { increment: 2 } },
    });
    const specCalls =
      prismaService.scanOrderingSpecOption.updateMany.mock.calls;
    expect(specCalls).toHaveLength(2);
  });

  it('余额退款：只创建一次标准销售退款与财务退款（通过 salesRecordRefundService）', async () => {
    prismaService.scanOrderItem.findMany.mockResolvedValue([]);
    prismaService.saleOrder.findUnique.mockResolvedValue({ id: 500 });

    await service.refund(
      { orderId: 1001, storeId: 11, version: 1, reason: '顾客申请' },
      201,
    );

    expect(prismaService.saleOrder.findUnique).toHaveBeenCalledWith({
      where: { scanOrderId: 1001 },
      select: { id: true },
    });
    expect(salesRecordRefundService.refundInTransaction).toHaveBeenCalledTimes(
      1,
    );
    expect(salesRecordRefundService.refundInTransaction).toHaveBeenCalledWith(
      prismaService,
      expect.objectContaining({ saleOrderId: 500 }),
    );
  });

  it('余额退款：积分已结算（settled）时原路返还积分并写入 earn 流水', async () => {
    prismaService.scanOrders.findUnique.mockResolvedValue({
      marketingSnapshot: {
        pointsUsed: 33,
        pointsSettlementStatus: 'settled',
      },
    });

    await service.refund(
      { orderId: 1001, storeId: 11, version: 1, reason: '顾客申请' },
      201,
    );

    expect(prismaService.marketingCustomer.update).toHaveBeenCalledWith({
      where: { id: 55 },
      data: { points: { increment: 33 } },
    });
    expect(prismaService.marketingPointsRecord.create).toHaveBeenCalledWith({
      data: {
        storeId: 11,
        customerId: 55,
        amount: 33,
        type: 'earn',
        description: '扫码点餐退款返还积分（订单 1001）',
      },
    });
    expect(prismaService.scanOrderRefundTask.updateMany).toHaveBeenCalledWith({
      where: {
        orderId: 1001,
        status: { in: ['pending', 'refunding', 'manual_pending'] },
      },
      data: { pointsRefundStatus: 'succeeded' },
    });
  });

  it('余额退款：积分未结算（pending）时不返还积分', async () => {
    prismaService.scanOrders.findUnique.mockResolvedValue({
      marketingSnapshot: {
        pointsUsed: 33,
        pointsSettlementStatus: 'pending',
      },
    });

    await service.refund(
      { orderId: 1001, storeId: 11, version: 1, reason: '顾客申请' },
      201,
    );

    expect(prismaService.marketingPointsRecord.create).not.toHaveBeenCalled();
  });

  it('余额退款：下单赠送积分（earnedPoints）一并回收并写 spend 流水', async () => {
    prismaService.scanOrders.findUnique.mockResolvedValue({
      marketingSnapshot: {
        pointsUsed: 82,
        earnedPoints: 2,
        pointsSettlementStatus: 'settled',
      },
    });
    prismaService.marketingCustomer.findUnique.mockResolvedValue({
      points: 84,
    });

    await service.refund(
      { orderId: 1001, storeId: 11, version: 1, reason: '顾客申请' },
      201,
    );

    // 返还抵扣积分 82
    expect(prismaService.marketingCustomer.update).toHaveBeenCalledWith({
      where: { id: 55 },
      data: { points: { increment: 82 } },
    });
    // 回收下单赠送积分 2
    expect(prismaService.marketingCustomer.update).toHaveBeenCalledWith({
      where: { id: 55 },
      data: { points: { decrement: 2 } },
    });
    expect(prismaService.marketingPointsRecord.create).toHaveBeenCalledWith({
      data: {
        storeId: 11,
        customerId: 55,
        amount: -2,
        type: 'spend',
        description: '扫码点餐退款回收消费赠送积分（订单 1001）',
      },
    });
  });

  it('余额退款：赠送积分超出当前可用积分时仅回收可用部分，不扣成负数', async () => {
    prismaService.scanOrders.findUnique.mockResolvedValue({
      marketingSnapshot: {
        pointsUsed: 82,
        earnedPoints: 10,
        pointsSettlementStatus: 'settled',
      },
    });
    prismaService.marketingCustomer.findUnique.mockResolvedValue({
      points: 4,
    });

    await service.refund(
      { orderId: 1001, storeId: 11, version: 1, reason: '顾客申请' },
      201,
    );

    expect(prismaService.marketingCustomer.update).toHaveBeenCalledWith({
      where: { id: 55 },
      data: { points: { decrement: 4 } },
    });
    expect(prismaService.marketingPointsRecord.create).toHaveBeenCalledWith({
      data: {
        storeId: 11,
        customerId: 55,
        amount: -4,
        type: 'spend',
        description: '扫码点餐退款回收消费赠送积分（订单 1001）',
      },
    });
  });

  it('余额退款：未找到标准销售单时不创建标准退款', async () => {
    prismaService.scanOrderItem.findMany.mockResolvedValue([]);
    prismaService.saleOrder.findUnique.mockResolvedValue(null);

    await service.refund(
      { orderId: 1001, storeId: 11, version: 1, reason: '顾客申请' },
      201,
    );

    expect(salesRecordRefundService.refundInTransaction).not.toHaveBeenCalled();
  });

  it('余额退款：原余额支付记录不存在时抛出 ConflictException 且不执行任何退款动作', async () => {
    prismaService.scanOrderBalanceTransaction.findUnique.mockResolvedValue(
      null,
    );

    await expect(
      service.refund(
        { orderId: 1001, storeId: 11, version: 1, reason: '顾客申请' },
        201,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prismaService.scanOrders.updateMany).not.toHaveBeenCalled();
    expect(salesRecordRefundService.refundInTransaction).not.toHaveBeenCalled();
  });
});
