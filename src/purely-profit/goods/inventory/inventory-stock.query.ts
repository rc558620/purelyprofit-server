import { Prisma } from '@prisma/client';
import type {
  InventoryAdjustmentLogCreateInput,
  InventoryAdjustmentRecord,
  InventoryMutableProductRecord,
  InventoryRevertLogRecord,
  InventoryRevertPurchaseParams,
  InventoryRevertSaleParams,
  InventorySaleAdjustmentLogRecord,
  InventoryTransactionClient,
} from './inventory.types';
import { sumCustodyFrozenQty } from '../../../shared/custody/custody-frozen-stock';

/**
 * 库存写路径的数据访问层：商品库存行与库存调整日志的全部 SQL 都收敛在这里，
 * 「先做什么、后做什么」的编排与业务校验见 inventory-stock.write.ts。
 *
 * 所有函数都显式接收事务 client：库存变更必须与调用方的业务主链路
 * 同事务提交 / 回滚，不允许各自单独落库。
 */

/**
 * 读取单个商品的客存冻结量。
 *
 * 未开启 frozen 口径的门店聚合结果恒为 0，因此这里不做门店开关判断：
 * 门店没开客存冻结时，本函数对既有库存链路完全无副作用。
 */
export async function resolveFrozenQty(
  transaction: InventoryTransactionClient,
  storeId: number,
  productId: number,
): Promise<number> {
  const frozenMap = await sumCustodyFrozenQty(transaction, storeId, [
    productId,
  ]);
  return frozenMap.get(productId) ?? 0;
}

/** 行锁查询返回的商品行：id/stock 为 int4，与 InventoryMutableProductRecord 同构 */
interface InventoryLockedProductRow {
  id: number;
  name: string;
  stock: number;
}

/**
 * 对库存商品行加排他锁，并连带读出当前库存（一次往返）。
 *
 * 锁必须在读之前拿到，否则读到的仍是未串行化的旧值；原来「先 FOR UPDATE 再 findFirst」
 * 是两次往返，合并成一条 SQL 后仍是持锁事务内读取，语义完全等价、少一次往返。
 */
export async function lockAndFindInventoryProductRow(
  transaction: InventoryTransactionClient,
  storeId: number,
  productId: number,
): Promise<InventoryMutableProductRecord | null> {
  const rows = await transaction.$queryRaw<InventoryLockedProductRow[]>`
    SELECT "id", "name", "stock"
    FROM "products"
    WHERE "id" = ${productId}
      AND "store_id" = ${storeId}
      AND "deleted_at" IS NULL
    FOR UPDATE
  `;

  return rows[0] ?? null;
}

/**
 * 批量读取门店下多个商品行（与单条口径一致：同门店 + 未软删）。
 *
 * 销售 / 入库 / 回滚一次会涉及多个商品，逐条查询会让事务内往返次数随商品数线性增长，
 * 事务持有时间与连接池占用也随之拉长；这里合并为一次 findMany。
 */
export async function findInventoryProductsForStore(
  transaction: InventoryTransactionClient,
  storeId: number,
  productIds: readonly number[],
): Promise<InventoryMutableProductRecord[]> {
  const uniqueIds = Array.from(new Set(productIds)).filter(
    (id) => Number.isSafeInteger(id) && id > 0,
  );
  if (uniqueIds.length === 0) {
    return [];
  }

  return transaction.product.findMany({
    where: {
      id: { in: uniqueIds },
      storeId,
      deletedAt: null,
    },
    select: {
      id: true,
      name: true,
      stock: true,
    },
  });
}

/**
 * 批量读取多个商品的客存冻结量（薄封装）。
 *
 * 与 resolveFrozenQty 同一口径，只是把「每商品一次 groupBy」合并为一次，
 * 未开启 frozen 的门店聚合结果恒为 0，对既有链路无副作用。
 */
export async function resolveFrozenQtyMap(
  transaction: InventoryTransactionClient,
  storeId: number,
  productIds: readonly number[],
): Promise<Map<number, number>> {
  return sumCustodyFrozenQty(transaction, storeId, productIds);
}

/**
 * 库存写路径的一次性读上下文：本次涉及的商品行 + 各商品的客存冻结量。
 *
 * 商品行与冻结量互不依赖，可并行读取；读的次数与商品数无关，
 * 事务内往返从「每商品 2 次」降为固定 2 次。
 */
export interface InventoryWriteContext {
  products: Map<number, InventoryMutableProductRecord>;
  frozenQty: Map<number, number>;
}

export async function loadInventoryWriteContext(
  transaction: InventoryTransactionClient,
  storeId: number,
  productIds: readonly number[],
): Promise<InventoryWriteContext> {
  const uniqueIds = Array.from(new Set(productIds));
  const [products, frozenQty] = await Promise.all([
    findInventoryProductsForStore(transaction, storeId, uniqueIds),
    resolveFrozenQtyMap(transaction, storeId, uniqueIds),
  ]);

  return {
    products: new Map(products.map((product) => [product.id, product])),
    frozenQty,
  };
}

export async function updateInventoryProductStock(
  transaction: InventoryTransactionClient,
  productId: number,
  stock: number | { increment: number },
): Promise<void> {
  await transaction.product.update({
    where: { id: productId },
    data: { stock },
  });
}

/**
 * 批量原子更新库存：N 个商品的增量更新合并为一条 UPDATE。
 *
 * 销售扣减 / 进货入库 / 单据回滚都在事务里逐商品 `UPDATE ... stock = stock + delta`，
 * 一行商品一次往返——追加点单一次选十几个商品就是十几次往返，而事务持有期间
 * 还会阻塞同日同店的其他建单（订单号走 pg_advisory_xact_lock）。
 *
 * 用 `FROM (VALUES ...)` 一次性更新：每条 delta 仍由数据库侧在行上做加法，
 * 与逐个 increment 的并发语义完全一致，不会引入 read-modify-write 竞态。
 *
 * ⚠️ 这里必须显式写 updated_at，因为绕过了 Prisma 的 @updatedAt（raw SQL 不会自动维护）。
 * 用 `NOW() AT TIME ZONE 'UTC'` 而非裸 NOW()： updated_at 是无时区的 timestamp，
 * 裸 NOW() 会按会话时区取值，与 Prisma 写入的 UTC 墙钟不一致（项目 SQL 时区规范 R1）。
 */
export async function updateInventoryProductStocks(
  transaction: InventoryTransactionClient,
  changes: ReadonlyArray<{ productId: number; delta: number }>,
): Promise<void> {
  if (changes.length === 0) {
    return;
  }

  // 单条时回退到 Prisma 的 update：没有往返可省，还能保留 @updatedAt 的自动维护
  if (changes.length === 1) {
    await updateInventoryProductStock(transaction, changes[0].productId, {
      increment: changes[0].delta,
    });
    return;
  }

  const valueRows = Prisma.join(
    changes.map(
      (change) => Prisma.sql`(${change.productId}::int, ${change.delta}::int)`,
    ),
  );

  await transaction.$executeRaw`
    UPDATE products AS p
    SET stock = p.stock + v.delta,
        updated_at = NOW() AT TIME ZONE 'UTC'
    FROM (VALUES ${valueRows}) AS v(product_id, delta)
    WHERE p.id = v.product_id
  `;
}

export async function createInventoryAdjustmentLog(
  transaction: InventoryTransactionClient,
  data: InventoryAdjustmentLogCreateInput,
): Promise<InventoryAdjustmentRecord> {
  return transaction.inventoryAdjustmentLog.create({
    data: {
      storeId: data.storeId,
      productId: data.productId,
      operatorStaffId: data.operatorStaffId,
      productName: data.productName,
      beforeStock: data.beforeStock,
      afterStock: data.afterStock,
      delta: data.delta,
      adjustType: data.adjustType,
      ...(data.note !== undefined ? { note: data.note } : {}),
      ...(data.purchaseOrderId !== undefined
        ? { purchaseOrderId: data.purchaseOrderId }
        : {}),
      ...(data.saleOrderId !== undefined
        ? { saleOrderId: data.saleOrderId }
        : {}),
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
}

/**
 * 批量写入库存调整日志（不返回记录）。
 *
 * 补货 / 销售扣减 / 回滚一次会写多条流水，逐条 create 是 N 次往返；这些路径都不消费
 * 返回值，合并为一次 createMany。需要回传单条流水（盘点调整要返回给前端）的场景仍走
 * createInventoryAdjustmentLog。
 */
export async function createInventoryAdjustmentLogs(
  transaction: InventoryTransactionClient,
  data: InventoryAdjustmentLogCreateInput[],
): Promise<void> {
  if (data.length === 0) {
    return;
  }

  await transaction.inventoryAdjustmentLog.createMany({
    // createMany 要求各行结构一致，缺失字段显式落 null（与省略时库内默认值一致）
    data: data.map((input) => ({
      storeId: input.storeId,
      productId: input.productId,
      operatorStaffId: input.operatorStaffId,
      productName: input.productName,
      beforeStock: input.beforeStock,
      afterStock: input.afterStock,
      delta: input.delta,
      adjustType: input.adjustType,
      note: input.note ?? null,
      purchaseOrderId: input.purchaseOrderId ?? null,
      saleOrderId: input.saleOrderId ?? null,
    })),
  });
}

export async function querySaleAdjustmentLogs(
  transaction: InventoryTransactionClient,
  params: InventoryRevertSaleParams,
): Promise<InventorySaleAdjustmentLogRecord[]> {
  return transaction.inventoryAdjustmentLog.findMany({
    where: {
      storeId: params.storeId,
      saleOrderId: params.saleOrderId,
      adjustType: 'sale',
    },
    orderBy: [{ id: 'asc' }],
    select: {
      productId: true,
      delta: true,
    },
  });
}

export async function deleteSaleAdjustmentLogs(
  transaction: InventoryTransactionClient,
  params: InventoryRevertSaleParams,
): Promise<void> {
  await transaction.inventoryAdjustmentLog.deleteMany({
    where: {
      storeId: params.storeId,
      saleOrderId: params.saleOrderId,
      adjustType: 'sale',
    },
  });
}

export async function queryPurchaseAdjustmentLogs(
  transaction: InventoryTransactionClient,
  params: InventoryRevertPurchaseParams,
): Promise<InventoryRevertLogRecord[]> {
  return transaction.inventoryAdjustmentLog.findMany({
    where: {
      storeId: params.storeId,
      purchaseOrderId: params.purchaseOrderId,
      adjustType: 'restock',
    },
    orderBy: [{ id: 'asc' }],
    select: {
      productId: true,
      delta: true,
    },
  });
}

export async function deletePurchaseAdjustmentLogs(
  transaction: InventoryTransactionClient,
  params: InventoryRevertPurchaseParams,
): Promise<void> {
  await transaction.inventoryAdjustmentLog.deleteMany({
    where: {
      storeId: params.storeId,
      purchaseOrderId: params.purchaseOrderId,
      adjustType: 'restock',
    },
  });
}
