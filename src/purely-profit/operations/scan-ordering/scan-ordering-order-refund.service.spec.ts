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
});
