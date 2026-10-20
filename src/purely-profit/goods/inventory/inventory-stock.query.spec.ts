import { createInventoryTransactionMock } from './inventory-stock.spec-helpers';
import {
  createInventoryAdjustmentLog,
  createInventoryAdjustmentLogs,
  deleteSaleAdjustmentLogs,
  findInventoryProductsForStore,
  lockAndFindInventoryProductRow,
  querySaleAdjustmentLogs,
  updateInventoryProductStock,
} from './inventory-stock.query';

describe('inventory-stock.query', () => {
  const createTransaction = createInventoryTransactionMock;

  it('findInventoryProductsForStore 会按门店和商品批量查询库存商品', async () => {
    const { transaction, productFindMany } = createTransaction();
    productFindMany.mockResolvedValue([
      { id: 101, name: '可口可乐 330ml', stock: 10 },
      { id: 102, name: '雪碧', stock: 5 },
    ]);

    await expect(
      findInventoryProductsForStore(transaction, 18, [101, 102, 101]),
    ).resolves.toEqual([
      { id: 101, name: '可口可乐 330ml', stock: 10 },
      { id: 102, name: '雪碧', stock: 5 },
    ]);

    /* 去重后单次 findMany，而非逐条 findFirst */
    expect(productFindMany).toHaveBeenCalledTimes(1);
    expect(productFindMany).toHaveBeenCalledWith({
      where: {
        id: { in: [101, 102] },
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

  it('findInventoryProductsForStore 在入参为空时不查询数据库', async () => {
    const { transaction, productFindMany } = createTransaction();

    await expect(
      findInventoryProductsForStore(transaction, 18, []),
    ).resolves.toEqual([]);

    expect(productFindMany).not.toHaveBeenCalled();
  });

  /** 行锁与读库存合并：一次往返既加锁又拿当前库存 */
  it('lockAndFindInventoryProductRow 会加锁并返回商品行', async () => {
    const { transaction, queryRaw } = createTransaction();
    queryRaw.mockResolvedValue([
      { id: 101, name: '可口可乐 330ml', stock: 10 },
    ]);

    await expect(
      lockAndFindInventoryProductRow(transaction, 18, 101),
    ).resolves.toEqual({
      id: 101,
      name: '可口可乐 330ml',
      stock: 10,
    });

    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it('lockAndFindInventoryProductRow 在商品不存在时返回 null', async () => {
    const { transaction, queryRaw } = createTransaction();
    queryRaw.mockResolvedValue([]);

    await expect(
      lockAndFindInventoryProductRow(transaction, 18, 999),
    ).resolves.toBeNull();
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

  it('createInventoryAdjustmentLogs 会补齐缺失字段后批量写日志', async () => {
    const { transaction, logCreateMany } = createTransaction();

    await createInventoryAdjustmentLogs(transaction, [
      {
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
      {
        storeId: 18,
        productId: 102,
        operatorStaffId: 8,
        productName: '雪碧',
        beforeStock: 5,
        afterStock: 8,
        delta: 3,
        adjustType: 'restock',
        purchaseOrderId: 88,
      },
    ]);

    /** 一次 createMany 替代逐条 create；缺失字段显式落 null 保证各行结构一致 */
    expect(logCreateMany).toHaveBeenCalledTimes(1);
    expect(logCreateMany).toHaveBeenCalledWith({
      data: [
        {
          storeId: 18,
          productId: 101,
          operatorStaffId: 8,
          productName: '可口可乐 330ml',
          beforeStock: 10,
          afterStock: 6,
          delta: -4,
          adjustType: 'sale',
          note: '销售扣减',
          purchaseOrderId: null,
          saleOrderId: 66,
        },
        {
          storeId: 18,
          productId: 102,
          operatorStaffId: 8,
          productName: '雪碧',
          beforeStock: 5,
          afterStock: 8,
          delta: 3,
          adjustType: 'restock',
          note: null,
          purchaseOrderId: 88,
          saleOrderId: null,
        },
      ],
    });
  });

  it('createInventoryAdjustmentLogs 在无日志时不写库', async () => {
    const { transaction, logCreateMany } = createTransaction();

    await createInventoryAdjustmentLogs(transaction, []);

    expect(logCreateMany).not.toHaveBeenCalled();
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
