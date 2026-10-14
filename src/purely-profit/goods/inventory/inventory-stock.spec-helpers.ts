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
  productFindFirst: jest.Mock;
  productUpdate: jest.Mock;
  logCreate: jest.Mock;
  logFindMany: jest.Mock;
  logDeleteMany: jest.Mock;
  custodyOrderGroupBy: jest.Mock;
  queryRaw: jest.Mock;
} {
  const productFindFirst = jest.fn();
  const productUpdate = jest.fn();
  const logCreate = jest.fn();
  const logFindMany = jest.fn();
  const logDeleteMany = jest.fn();
  // 客存冻结聚合：默认无冻结量，未开启 frozen 的门店行为不变
  const custodyOrderGroupBy = jest.fn().mockResolvedValue([]);
  // 行锁 SELECT ... FOR UPDATE
  const queryRaw = jest.fn().mockResolvedValue([]);

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
      $queryRaw: queryRaw,
    } as unknown as InventoryTransactionClient,
    productFindFirst,
    productUpdate,
    logCreate,
    logFindMany,
    logDeleteMany,
    custodyOrderGroupBy,
    queryRaw,
  };
}
