import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { ScanOrderingRealtimeService } from '../../../purely-club/scan-ordering/scan-ordering-realtime.service';
import { ScanOrderingRefundService } from '../../../purely-club/scan-ordering/scan-ordering-refund.service';
import { SalesRecordRefundService } from '../sales-record/sales-record-refund.service';
import { ScanOrderingOrderRefundBalanceService } from './scan-ordering-order-refund-balance.service';
import { ScanOrderingOrderRefundHandlingService } from './scan-ordering-order-refund.service';

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

  const configService = {
    get: jest.fn(),
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
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<ScanOrderingOrderRefundHandlingService>(
      ScanOrderingOrderRefundHandlingService,
    );
  });

  it('普通退款完成确认：订单置为 rejected/refunded/closed 并版本加一', async () => {
    prismaService.scanOrders.updateMany.mockResolvedValueOnce({ count: 1 });

    await service.completeRefund(
      { id: 1, name: '收银员' } as never,
      1001,
      2,
      'RF20260803001',
      'wx-refund-123',
    );

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

  it('普通退款完成确认：恢复库存一次（菜单商品、Product.stock、规格）', async () => {
    prismaService.scanOrders.updateMany.mockResolvedValueOnce({ count: 1 });
    prismaService.scanOrderItem.findMany.mockResolvedValue([
      {
        menuProductId: 201,
        quantity: 2,
        menuProduct: { productId: 901 },
        specs: [{ specOptionId: 301 }],
      },
    ]);

    await service.completeRefund({ id: 1, name: '收银员' } as never, 1001, 2);

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
    expect(
      prismaService.scanOrderingSpecOption.updateMany,
    ).toHaveBeenCalledTimes(1);
  });

  it('普通退款完成确认：只创建一次标准销售退款与财务退款', async () => {
    prismaService.scanOrders.updateMany.mockResolvedValueOnce({ count: 1 });
    prismaService.saleOrder.findUnique.mockResolvedValue({ id: 500 });

    await service.completeRefund({ id: 1, name: '收银员' } as never, 1001, 2);

    expect(prismaService.saleOrder.findUnique).toHaveBeenCalledWith({
      where: { scanOrderId: 1001 },
      select: { id: true },
    });
    expect(salesRecordRefundService.refundInTransaction).toHaveBeenCalledTimes(
      1,
    );
  });

  it('普通退款完成确认：无标准销售单时不创建标准退款', async () => {
    prismaService.scanOrders.updateMany.mockResolvedValueOnce({ count: 1 });
    prismaService.saleOrder.findUnique.mockResolvedValue(null);

    await service.completeRefund({ id: 1, name: '收银员' } as never, 1001, 2);

    expect(salesRecordRefundService.refundInTransaction).not.toHaveBeenCalled();
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
    expect(salesRecordRefundService.refundInTransaction).not.toHaveBeenCalled();
  });
});
