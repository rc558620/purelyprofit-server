import { Test, TestingModule } from '@nestjs/testing';
import { SalesRecordRefundService } from '../sales-record/sales-record-refund.service';
import { ScanOrderingRefundStockRestoreService } from './scan-ordering-refund-stock-restore.service';

describe('ScanOrderingRefundStockRestoreService', () => {
  let service: ScanOrderingRefundStockRestoreService;

  const tx = {
    scanOrders: {
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
    saleOrder: {
      findUnique: jest.fn(),
    },
  };

  const salesRecordRefundService = {
    refundInTransaction: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    tx.scanOrders.findUniqueOrThrow.mockResolvedValue({ storeId: 11 });
    tx.scanOrderItem.findMany.mockResolvedValue([]);
    tx.saleOrder.findUnique.mockResolvedValue(null);
    salesRecordRefundService.refundInTransaction.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScanOrderingRefundStockRestoreService,
        {
          provide: SalesRecordRefundService,
          useValue: salesRecordRefundService,
        },
      ],
    }).compile();

    service = module.get<ScanOrderingRefundStockRestoreService>(
      ScanOrderingRefundStockRestoreService,
    );
  });

  it('恢复库存：归还菜单商品库存、销量与共用 Product.stock', async () => {
    tx.scanOrderItem.findMany.mockResolvedValue([
      {
        menuProductId: 201,
        quantity: 2,
        menuProduct: { productId: 901 },
        specs: [{ specOptionId: 301 }],
      },
    ]);

    await service.restoreReservedStock(tx as never, 1001);

    expect(tx.scanOrderingMenuProduct.updateMany).toHaveBeenCalledWith({
      where: { id: 201, storeId: 11, stockMode: 'finite' },
      data: {
        stockQuantity: { increment: 2 },
        salesCount: { decrement: 2 },
        version: { increment: 1 },
      },
    });
    expect(tx.product.updateMany).toHaveBeenCalledWith({
      where: { id: 901, storeId: 11, deletedAt: null },
      data: { stock: { increment: 2 } },
    });
  });

  it('恢复库存：规格库存按订单数量聚合后归还一次', async () => {
    tx.scanOrderItem.findMany.mockResolvedValue([
      {
        menuProductId: 201,
        quantity: 2,
        menuProduct: { productId: 901 },
        specs: [{ specOptionId: 301 }, { specOptionId: 302 }],
      },
    ]);

    await service.restoreReservedStock(tx as never, 1001);

    expect(tx.scanOrderingSpecOption.updateMany).toHaveBeenCalledTimes(2);
    expect(tx.scanOrderingSpecOption.updateMany).toHaveBeenCalledWith({
      where: { id: 301, stockQuantity: { not: null } },
      data: {
        stockQuantity: { increment: 2 },
        version: { increment: 1 },
      },
    });
  });

  it('恢复库存：无商品明细时不更新任何库存', async () => {
    await service.restoreReservedStock(tx as never, 1001);

    expect(tx.scanOrderingMenuProduct.updateMany).not.toHaveBeenCalled();
    expect(tx.scanOrderingSpecOption.updateMany).not.toHaveBeenCalled();
  });

  it('销售冲销：存在标准销售单时只创建一次退款', async () => {
    tx.saleOrder.findUnique.mockResolvedValue({ id: 500 });

    await service.refundSaleOrder(tx as never, 1001);

    expect(tx.saleOrder.findUnique).toHaveBeenCalledWith({
      where: { scanOrderId: 1001 },
      select: { id: true },
    });
    expect(salesRecordRefundService.refundInTransaction).toHaveBeenCalledTimes(
      1,
    );
    expect(salesRecordRefundService.refundInTransaction).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ saleOrderId: 500 }),
    );
  });

  it('销售冲销：无标准销售单时跳过退款', async () => {
    await service.refundSaleOrder(tx as never, 1001);

    expect(salesRecordRefundService.refundInTransaction).not.toHaveBeenCalled();
  });
});
