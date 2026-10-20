import { createInventoryTransactionMock } from './inventory-stock.spec-helpers';
import {
  executeInventoryManualAdjustment,
  recordInventoryRestock,
  recordInventorySaleDeduction,
  revertInventoryPurchaseRestock,
  revertInventorySaleDeduction,
} from './inventory-stock.write';

describe('inventory-stock.write', () => {
  const createTransaction = createInventoryTransactionMock;

  it('executeInventoryManualAdjustment 会查询商品后更新库存并写日志', async () => {
    const { transaction, queryRaw, productUpdate, logCreate } =
      createTransaction();
    const createdAt = new Date('2026-05-14T11:00:00.000Z');
    /* 加锁与读库存合并：一次 FOR UPDATE 查询直接带回商品行 */
    queryRaw.mockResolvedValue([
      { id: 101, name: '可口可乐 330ml', stock: 10 },
    ]);
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
   * 回归用：调整前必须对该商品行加排他锁。
   * set 模式是「读旧值 → 写绝对值」的 read-modify-write，Read Committed 下两个并发
   * 盘点会各自基于同一份旧 stock 计算，两条日志的 delta 合计与账面实际变化不一致，
   * beforeStock 也会全部记成同一个旧值。
   *
   * 锁与读已合并为一条 SELECT ... FOR UPDATE：加锁即读数，不存在「锁了没读」的中间态。
   */
  it('executeInventoryManualAdjustment 会通过加锁查询读取库存', async () => {
    const { transaction, queryRaw } = createTransaction();
    queryRaw.mockResolvedValue([
      { id: 101, name: '可口可乐 330ml', stock: 10 },
    ]);

    await executeInventoryManualAdjustment(transaction, {
      storeId: 18,
      productId: 101,
      operatorStaffId: 8,
      targetStock: 15,
      mode: 'set',
      adjustType: 'manual',
      note: '盘点修正',
    });

    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  /*
   * 回归用：set 模式下 targetStock 等于当前库存时不产生 delta=0 的空流水。
   * service 层只能拦住显式传入的 delta=0，这种「盘点结果与账面一致」的情况
   * 必须到 domain 层（已读到 product.stock）才能判定。
   */
  it('executeInventoryManualAdjustment set 模式下库存无变化时拒绝', async () => {
    const { transaction, queryRaw, productUpdate, logCreate } =
      createTransaction();
    queryRaw.mockResolvedValue([
      { id: 101, name: '可口可乐 330ml', stock: 10 },
    ]);

    await expect(
      executeInventoryManualAdjustment(transaction, {
        storeId: 18,
        productId: 101,
        operatorStaffId: 8,
        targetStock: 10,
        mode: 'set',
        adjustType: 'manual',
        note: '盘点修正',
      }),
    ).rejects.toThrow(/无需调整/);

    expect(productUpdate).not.toHaveBeenCalled();
    expect(logCreate).not.toHaveBeenCalled();
  });

  /*
   * 回归用：物理库存不允许被改到低于「在存冻结量」。
   * 否则会出现「冻结量 > 物理库存」的脏数据，可用库存被静默截断为 0，
   * 商品不可售且无任何日志可追溯。
   */
  it('executeInventoryManualAdjustment 调整后库存低于客存冻结量时拒绝并回滚', async () => {
    const {
      transaction,
      queryRaw,
      productUpdate,
      logCreate,
      custodyOrderGroupBy,
    } = createTransaction();
    queryRaw.mockResolvedValue([{ id: 101, name: '茅台', stock: 20 }]);
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
    const {
      transaction,
      queryRaw,
      productUpdate,
      logCreate,
      custodyOrderGroupBy,
    } = createTransaction();
    queryRaw.mockResolvedValue([{ id: 101, name: '茅台', stock: 20 }]);
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

  /*
   * 回归用：批量路径把「逐商品 2 次读」合并为固定 2 次读（商品行 + 冻结量），
   * 并把多条流水合并为一次 createMany。
   */
  it('recordInventoryRestock 会批量补货并一次性写入补货日志', async () => {
    const { transaction, productFindMany, productUpdate, logCreateMany } =
      createTransaction();
    productFindMany.mockResolvedValue([
      { id: 101, name: '可口可乐 330ml', stock: 10 },
      { id: 102, name: '雪碧', stock: 5 },
    ]);

    await recordInventoryRestock(transaction, {
      storeId: 18,
      purchaseOrderId: 88,
      operatorStaffId: 8,
      items: [
        { productId: 101, quantity: 5 },
        { productId: 102, quantity: 3 },
      ],
    });

    /* 无论商品几条，商品行与冻结量各只查一次 */
    expect(productFindMany).toHaveBeenCalledTimes(1);

    /* D2 修复：restock 使用原子 increment 而非绝对赋值 */
    expect(productUpdate).toHaveBeenNthCalledWith(1, {
      where: { id: 101 },
      data: { stock: { increment: 5 } },
    });
    expect(productUpdate).toHaveBeenNthCalledWith(2, {
      where: { id: 102 },
      data: { stock: { increment: 3 } },
    });
    expect(logCreateMany).toHaveBeenCalledTimes(1);
    expect(logCreateMany).toHaveBeenCalledWith({
      data: [
        {
          storeId: 18,
          productId: 101,
          operatorStaffId: 8,
          productName: '可口可乐 330ml',
          beforeStock: 10,
          afterStock: 15,
          delta: 5,
          adjustType: 'restock',
          note: null,
          purchaseOrderId: 88,
          saleOrderId: null,
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

  it('recordInventorySaleDeduction 会扣减库存并补充销售日志字段', async () => {
    const { transaction, productFindMany, productUpdate, logCreateMany } =
      createTransaction();
    productFindMany.mockResolvedValue([
      { id: 101, name: '可口可乐 330ml', stock: 10 },
    ]);

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
      ],
    });
  });

  /** 商品被软删 / 跨门店时，进货与销售主链路跳过而非整单失败 */
  it('recordInventorySaleDeduction 会跳过不存在的商品', async () => {
    const { transaction, productFindMany, productUpdate, logCreateMany } =
      createTransaction();
    productFindMany.mockResolvedValue([
      { id: 101, name: '可口可乐 330ml', stock: 10 },
    ]);

    await recordInventorySaleDeduction(transaction, {
      storeId: 18,
      saleOrderId: 66,
      operatorStaffId: 8,
      items: [
        { productId: 101, quantity: 4 },
        { productId: 999, quantity: 2 },
      ],
    });

    expect(productUpdate).toHaveBeenCalledTimes(1);
    expect(logCreateMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ productId: 101, delta: -4 })],
    });
  });

  it('revertInventorySaleDeduction 会回滚库存并删除销售日志', async () => {
    const {
      transaction,
      productFindMany,
      productUpdate,
      logFindMany,
      logDeleteMany,
    } = createTransaction();
    logFindMany.mockResolvedValue([
      { productId: 101, delta: -4 },
      { productId: 102, delta: -2 },
    ]);
    productFindMany.mockResolvedValue([
      { id: 101, name: '可口可乐 330ml', stock: 6 },
      { id: 102, name: '雪碧', stock: 5 },
    ]);

    await revertInventorySaleDeduction(transaction, {
      storeId: 18,
      saleOrderId: 66,
    });

    /* 回滚同样只做一次批量读 */
    expect(productFindMany).toHaveBeenCalledTimes(1);

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

  it('revertInventoryPurchaseRestock 会反向扣减库存并删除入库日志', async () => {
    const {
      transaction,
      productFindMany,
      productUpdate,
      logFindMany,
      logDeleteMany,
    } = createTransaction();
    logFindMany.mockResolvedValue([
      { productId: 101, delta: 6 },
      { productId: 102, delta: 3 },
    ]);
    productFindMany.mockResolvedValue([
      { id: 101, name: '可口可乐 330ml', stock: 10 },
      { id: 102, name: '雪碧', stock: 5 },
    ]);

    await revertInventoryPurchaseRestock(transaction, {
      storeId: 18,
      purchaseOrderId: 77,
    });

    expect(productUpdate).toHaveBeenNthCalledWith(1, {
      where: { id: 101 },
      data: { stock: { increment: -6 } },
    });
    expect(productUpdate).toHaveBeenNthCalledWith(2, {
      where: { id: 102 },
      data: { stock: { increment: -3 } },
    });
    // 先删日志再回滚，保证重复调用幂等
    expect(logDeleteMany).toHaveBeenCalledWith({
      where: {
        storeId: 18,
        purchaseOrderId: 77,
        adjustType: 'restock',
      },
    });
    expect(logDeleteMany.mock.invocationCallOrder[0]).toBeLessThan(
      productUpdate.mock.invocationCallOrder[0],
    );
  });

  it('revertInventoryPurchaseRestock 在无日志时不做任何库存变更（幂等）', async () => {
    const {
      transaction,
      productFindMany,
      productUpdate,
      logFindMany,
      logDeleteMany,
    } = createTransaction();
    logFindMany.mockResolvedValue([]);

    await revertInventoryPurchaseRestock(transaction, {
      storeId: 18,
      purchaseOrderId: 77,
    });

    expect(productFindMany).not.toHaveBeenCalled();
    expect(productUpdate).not.toHaveBeenCalled();
    expect(logDeleteMany).not.toHaveBeenCalled();
  });

  it('revertInventoryPurchaseRestock 在库存不足时只回滚可用库存，不产生负库存', async () => {
    const { transaction, productFindMany, productUpdate, logFindMany } =
      createTransaction();
    logFindMany.mockResolvedValue([{ productId: 101, delta: 6 }]);
    // 物理库存 4（其中 3 为客存冻结），可回滚量仅 1
    productFindMany.mockResolvedValue([
      { id: 101, name: '可口可乐 330ml', stock: 4 },
    ]);
    (
      transaction as unknown as { custodyOrder: { groupBy: jest.Mock } }
    ).custodyOrder.groupBy.mockResolvedValue([
      { productId: 101, _sum: { remainingQty: 3 } },
    ]);

    await revertInventoryPurchaseRestock(transaction, {
      storeId: 18,
      purchaseOrderId: 77,
    });

    expect(productUpdate).toHaveBeenCalledWith({
      where: { id: 101 },
      data: { stock: { increment: -1 } },
    });
  });
});
