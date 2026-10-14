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

/**
 * 对库存商品行加排他锁，保证「读 stock → 客存冻结校验 → 写库存 → 写流水」全程串行。
 */
export async function lockInventoryProductRow(
  transaction: InventoryTransactionClient,
  productId: number,
): Promise<void> {
  await transaction.$queryRaw`SELECT "id" FROM "products" WHERE "id" = ${productId} FOR UPDATE`;
}

export async function findInventoryProductForStore(
  transaction: InventoryTransactionClient,
  storeId: number,
  productId: number,
): Promise<InventoryMutableProductRecord | null> {
  return transaction.product.findFirst({
    where: {
      id: productId,
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
