import { createInventoryTransactionMock } from './inventory-stock.spec-helpers';
import {
  createInventoryAdjustmentLog,
  deleteSaleAdjustmentLogs,
  findInventoryProductForStore,
  querySaleAdjustmentLogs,
  updateInventoryProductStock,
} from './inventory-stock.query';

describe('inventory-stock.query', () => {
  const createTransaction = createInventoryTransactionMock;

  it('findInventoryProductForStore 会按门店和商品查询库存商品', async () => {
    const { transaction, productFindFirst } = createTransaction();
    productFindFirst.mockResolvedValue({
      id: 101,
      name: '可口可乐 330ml',
      stock: 10,
    });

    await expect(
      findInventoryProductForStore(transaction, 18, 101),
    ).resolves.toEqual({
      id: 101,
      name: '可口可乐 330ml',
      stock: 10,
    });

    expect(productFindFirst).toHaveBeenCalledWith({
      where: {
        id: 101,
        storeId: 18,
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        stock: true,
      },
    });
  });

  it('updateInventoryProductStock 会更新商品库存', async () => {
    const { transaction, productUpdate } = createTransaction();
    productUpdate.mockResolvedValue({ id: 101, stock: 6 });

    await updateInventoryProductStock(transaction, 101, 6);

    expect(productUpdate).toHaveBeenCalledWith({
      where: { id: 101 },
      data: { stock: 6 },
    });
  });

  it('createInventoryAdjustmentLog 会按统一 select 结构写入日志', async () => {
    const { transaction, logCreate } = createTransaction();
    const createdAt = new Date('2026-05-14T11:00:00.000Z');
    logCreate.mockResolvedValue({
      id: 31,
      productId: 101,
      productName: '可口可乐 330ml',
      beforeStock: 10,
      afterStock: 6,
      delta: -4,
      adjustType: 'sale',
      note: '销售扣减',
      purchaseOrderId: null,
      createdAt,
    });

    await expect(
      createInventoryAdjustmentLog(transaction, {
        storeId: 18,
        productId: 101,
        operatorStaffId: 8,
        productName: '可口可乐 330ml',
        beforeStock: 10,
        afterStock: 6,
        delta: -4,
        adjustType: 'sale',
        note: '销售扣减',
        saleOrderId: 66,
      }),
    ).resolves.toEqual({
      id: 31,
      productId: 101,
      productName: '可口可乐 330ml',
      beforeStock: 10,
      afterStock: 6,
      delta: -4,
      adjustType: 'sale',
      note: '销售扣减',
      purchaseOrderId: null,
      createdAt,
    });

    expect(logCreate).toHaveBeenCalledWith({
      data: {
        storeId: 18,
        productId: 101,
        operatorStaffId: 8,
        productName: '可口可乐 330ml',
        beforeStock: 10,
        afterStock: 6,
        delta: -4,
        adjustType: 'sale',
        note: '销售扣减',
        saleOrderId: 66,
      },
      select: {
        id: true,
        productId: true,
        productName: true,
        beforeStock: true,
        afterStock: true,
        delta: true,
        adjustType: true,
        note: true,
        purchaseOrderId: true,
        createdAt: true,
      },
    });
  });

  it('querySaleAdjustmentLogs 会按销售单查询扣减日志', async () => {
    const { transaction, logFindMany } = createTransaction();
    logFindMany.mockResolvedValue([{ productId: 101, delta: -4 }]);

    await expect(
      querySaleAdjustmentLogs(transaction, {
        storeId: 18,
        saleOrderId: 66,
      }),
    ).resolves.toEqual([{ productId: 101, delta: -4 }]);

    expect(logFindMany).toHaveBeenCalledWith({
      where: {
        storeId: 18,
        saleOrderId: 66,
        adjustType: 'sale',
      },
      orderBy: [{ id: 'asc' }],
      select: {
        productId: true,
        delta: true,
      },
    });
  });

  it('deleteSaleAdjustmentLogs 会删除销售扣减日志', async () => {
    const { transaction, logDeleteMany } = createTransaction();
    logDeleteMany.mockResolvedValue({ count: 1 });

    await deleteSaleAdjustmentLogs(transaction, {
      storeId: 18,
      saleOrderId: 66,
    });

    expect(logDeleteMany).toHaveBeenCalledWith({
      where: {
        storeId: 18,
        saleOrderId: 66,
        adjustType: 'sale',
      },
    });
  });
});
