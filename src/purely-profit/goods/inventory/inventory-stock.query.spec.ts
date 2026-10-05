import {
  createInventoryAdjustmentLog,
  deleteSaleAdjustmentLogs,
  executeInventoryManualAdjustment,
  findInventoryProductForStore,
  querySaleAdjustmentLogs,
  recordInventoryRestock,
  recordInventorySaleDeduction,
  revertInventorySaleDeduction,
  updateInventoryProductStock,
} from './inventory-stock.query';
import type { InventoryTransactionClient } from './inventory.types';

describe('inventory-stock.query', () => {
  function createTransaction(): {
    transaction: InventoryTransactionClient;
    productFindFirst: jest.Mock;
    productUpdate: jest.Mock;
    logCreate: jest.Mock;
    logFindMany: jest.Mock;
    logDeleteMany: jest.Mock;
    custodyOrderGroupBy: jest.Mock;
  } {
    const productFindFirst = jest.fn();
    const productUpdate = jest.fn();
    const logCreate = jest.fn();
    const logFindMany = jest.fn();
    const logDeleteMany = jest.fn();
    // 客存冻结聚合：默认无冻结量，未开启 frozen 的门店行为不变
    const custodyOrderGroupBy = jest.fn().mockResolvedValue([]);

    return {
      transaction: {
        product: {
          findFirst: productFindFirst,
          update: productUpdate,
        },
        inventoryAdjustmentLog: {
          create: logCreate,
          findMany: logFindMany,
          deleteMany: logDeleteMany,
        },
        custodyOrder: {
          groupBy: custodyOrderGroupBy,
        },
      } as unknown as InventoryTransactionClient,
      productFindFirst,
      productUpdate,
      logCreate,
      logFindMany,
      logDeleteMany,
      custodyOrderGroupBy,
    };
  }

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

  it('executeInventoryManualAdjustment 会查询商品后更新库存并写日志', async () => {
    const { transaction, productFindFirst, productUpdate, logCreate } =
      createTransaction();
    const createdAt = new Date('2026-05-14T11:00:00.000Z');
    productFindFirst.mockResolvedValue({
      id: 101,
      name: '可口可乐 330ml',
      stock: 10,
    });
    logCreate.mockResolvedValue({
      id: 31,
      productId: 101,
      productName: '可口可乐 330ml',
      beforeStock: 10,
      afterStock: 7,
      delta: -3,
      adjustType: 'manual',
      note: '盘点修正',
      purchaseOrderId: null,
      createdAt,
    });

    await expect(
      executeInventoryManualAdjustment(transaction, {
        storeId: 18,
        productId: 101,
        operatorStaffId: 8,
        delta: -3,
        mode: 'delta',
        adjustType: 'manual',
        note: '盘点修正',
      }),
    ).resolves.toEqual({
      id: 31,
      productId: 101,
      productName: '可口可乐 330ml',
      beforeStock: 10,
      afterStock: 7,
      delta: -3,
      adjustType: 'manual',
      note: '盘点修正',
      purchaseOrderId: null,
      createdAt,
    });

    /* D2 修复：delta 模式下使用原子 increment 而非绝对赋值 */
    expect(productUpdate).toHaveBeenCalledWith({
      where: { id: 101 },
      data: { stock: { increment: -3 } },
    });
  });

  /*
   * 回归用：物理库存不允许被改到低于「在存冻结量」。
   * 否则会出现「冻结量 > 物理库存」的脏数据，可用库存被静默截断为 0，
   * 商品不可售且无任何日志可追溯。
   */
  it('executeInventoryManualAdjustment 调整后库存低于客存冻结量时拒绝并回滚', async () => {
    const { transaction, productFindFirst, productUpdate, logCreate, custodyOrderGroupBy } =
      createTransaction();
    productFindFirst.mockResolvedValue({ id: 101, name: '茅台', stock: 20 });
    // 该商品有 12 件被客存冻结，可用库存只有 8
    custodyOrderGroupBy.mockResolvedValue([
      { productId: 101, _sum: { remainingQty: 12 } },
    ]);

    // delta 模式：20 - 15 = 5 < 12
    await expect(
      executeInventoryManualAdjustment(transaction, {
        storeId: 18,
        productId: 101,
        operatorStaffId: 8,
        delta: -15,
        mode: 'delta',
        adjustType: 'manual',
        note: '盘点修正',
      }),
    ).rejects.toThrow(/低于该商品的客存冻结量 12/);

    // set 模式：直接把库存压到 3 < 12
    await expect(
      executeInventoryManualAdjustment(transaction, {
        storeId: 18,
        productId: 101,
        operatorStaffId: 8,
        targetStock: 3,
        mode: 'set',
        adjustType: 'manual',
        note: '盘点修正',
      }),
    ).rejects.toThrow(/低于该商品的客存冻结量 12/);

    expect(productUpdate).not.toHaveBeenCalled();
    expect(logCreate).not.toHaveBeenCalled();
  });

  it('executeInventoryManualAdjustment 调整后库存不低于客存冻结量时放行', async () => {
    const { transaction, productFindFirst, productUpdate, logCreate, custodyOrderGroupBy } =
      createTransaction();
    productFindFirst.mockResolvedValue({ id: 101, name: '茅台', stock: 20 });
    custodyOrderGroupBy.mockResolvedValue([
      { productId: 101, _sum: { remainingQty: 12 } },
    ]);
    logCreate.mockResolvedValue({
      id: 32,
      productId: 101,
      productName: '茅台',
      beforeStock: 20,
      afterStock: 12,
      delta: -8,
      adjustType: 'manual',
      note: '盘点修正',
      purchaseOrderId: null,
      createdAt: new Date('2026-05-14T11:00:00.000Z'),
    });

    // 恰好扣到冻结量边界：afterStock = 12 == frozenQty，应放行
    await expect(
      executeInventoryManualAdjustment(transaction, {
        storeId: 18,
        productId: 101,
        operatorStaffId: 8,
        delta: -8,
        mode: 'delta',
        adjustType: 'manual',
        note: '盘点修正',
      }),
    ).resolves.toBeDefined();

    expect(productUpdate).toHaveBeenCalledWith({
      where: { id: 101 },
      data: { stock: { increment: -8 } },
    });
    expect(logCreate).toHaveBeenCalled();
  });

  it('recordInventoryRestock 会批量补货并写入补货日志', async () => {
    const { transaction, productFindFirst, productUpdate, logCreate } =
      createTransaction();
    productFindFirst
      .mockResolvedValueOnce({ id: 101, name: '可口可乐 330ml', stock: 10 })
      .mockResolvedValueOnce({ id: 102, name: '雪碧', stock: 5 });
    logCreate.mockResolvedValue({
      id: 1,
      productId: 101,
      productName: 'mock',
      beforeStock: 0,
      afterStock: 0,
      delta: 0,
      adjustType: 'restock',
      note: null,
      purchaseOrderId: null,
      createdAt: new Date('2026-05-14T11:00:00.000Z'),
    });

    await recordInventoryRestock(transaction, {
      storeId: 18,
      purchaseOrderId: 88,
      operatorStaffId: 8,
      items: [
        { productId: 101, quantity: 5 },
        { productId: 102, quantity: 3 },
      ],
    });

    /* D2 修复：restock 使用原子 increment 而非绝对赋值 */
    expect(productUpdate).toHaveBeenNthCalledWith(1, {
      where: { id: 101 },
      data: { stock: { increment: 5 } },
    });
    expect(productUpdate).toHaveBeenNthCalledWith(2, {
      where: { id: 102 },
      data: { stock: { increment: 3 } },
    });
    expect(logCreate).toHaveBeenNthCalledWith(1, {
      data: {
        storeId: 18,
        productId: 101,
        operatorStaffId: 8,
        productName: '可口可乐 330ml',
        beforeStock: 10,
        afterStock: 15,
        delta: 5,
        adjustType: 'restock',
        purchaseOrderId: 88,
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

  it('recordInventorySaleDeduction 会扣减库存并补充销售日志字段', async () => {
    const { transaction, productFindFirst, productUpdate, logCreate } =
      createTransaction();
    productFindFirst.mockResolvedValue({
      id: 101,
      name: '可口可乐 330ml',
      stock: 10,
    });
    logCreate.mockResolvedValue({
      id: 41,
      productId: 101,
      productName: '可口可乐 330ml',
      beforeStock: 10,
      afterStock: 6,
      delta: -4,
      adjustType: 'sale',
      note: '销售扣减',
      purchaseOrderId: null,
      createdAt: new Date('2026-05-14T12:00:00.000Z'),
    });

    await recordInventorySaleDeduction(transaction, {
      storeId: 18,
      saleOrderId: 66,
      operatorStaffId: 8,
      items: [{ productId: 101, quantity: 4 }],
    });

    /* D2 修复：sale 扣减使用原子 increment(-quantity) 而非绝对赋值 */
    expect(productUpdate).toHaveBeenCalledWith({
      where: { id: 101 },
      data: { stock: { increment: -4 } },
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

  it('revertInventorySaleDeduction 会回滚库存并删除销售日志', async () => {
    const {
      transaction,
      productFindFirst,
      productUpdate,
      logFindMany,
      logDeleteMany,
    } = createTransaction();
    logFindMany.mockResolvedValue([
      { productId: 101, delta: -4 },
      { productId: 102, delta: -2 },
    ]);
    productFindFirst
      .mockResolvedValueOnce({ id: 101, name: '可口可乐 330ml', stock: 6 })
      .mockResolvedValueOnce({ id: 102, name: '雪碧', stock: 5 });

    await revertInventorySaleDeduction(transaction, {
      storeId: 18,
      saleOrderId: 66,
    });

    /* D2 修复：revert 使用原子 increment(-delta) 而非读后写绝对值 */
    expect(productUpdate).toHaveBeenNthCalledWith(1, {
      where: { id: 101 },
      data: { stock: { increment: 4 } },
    });
    expect(productUpdate).toHaveBeenNthCalledWith(2, {
      where: { id: 102 },
      data: { stock: { increment: 2 } },
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
