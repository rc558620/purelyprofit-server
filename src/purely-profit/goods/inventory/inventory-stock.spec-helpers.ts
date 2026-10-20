import type { InventoryTransactionClient } from './inventory.types';

/**
 * 库存写路径的单测替身：把 product 行读写、库存调整日志读写、客存冻结聚合
 * 与行锁 `$queryRaw` 全部换成 jest.Mock，便于断言调用次序与参数。
 *
 * 客存冻结聚合默认返回空、行锁默认返回空结果集：
 * 未开启客存冻结的门店行为不受影响。
 */
export function createInventoryTransactionMock(): {
  transaction: InventoryTransactionClient;
  /** 批量读商品行（库存写路径统一入口） */
  productFindMany: jest.Mock;
  productUpdate: jest.Mock;
  logCreate: jest.Mock;
  /** 批量写库存调整日志（返回值被丢弃的批量变更路径） */
  logCreateMany: jest.Mock;
  logFindMany: jest.Mock;
  logDeleteMany: jest.Mock;
  custodyOrderGroupBy: jest.Mock;
  queryRaw: jest.Mock;
} {
  const productFindMany = jest.fn().mockResolvedValue([]);
  const productUpdate = jest.fn();
  const logCreate = jest.fn();
  const logCreateMany = jest.fn().mockResolvedValue({ count: 0 });
  const logFindMany = jest.fn();
  const logDeleteMany = jest.fn();
  // 客存冻结聚合：默认无冻结量，未开启 frozen 的门店行为不变
  const custodyOrderGroupBy = jest.fn().mockResolvedValue([]);
  // 行锁 + 读库存合并后的 SELECT ... FOR UPDATE
  const queryRaw = jest.fn().mockResolvedValue([]);

  return {
    transaction: {
      product: {
        findMany: productFindMany,
        update: productUpdate,
      },
      inventoryAdjustmentLog: {
        create: logCreate,
        createMany: logCreateMany,
        findMany: logFindMany,
        deleteMany: logDeleteMany,
      },
      custodyOrder: {
        groupBy: custodyOrderGroupBy,
      },
      $queryRaw: queryRaw,
    } as unknown as InventoryTransactionClient,
    productFindMany,
    productUpdate,
    logCreate,
    logCreateMany,
    logFindMany,
    logDeleteMany,
    custodyOrderGroupBy,
    queryRaw,
  };
}
