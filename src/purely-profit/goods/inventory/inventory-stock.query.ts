import type {
  InventoryAdjustmentRecord,
  InventoryAdjustmentLogCreateInput,
  InventoryManualAdjustmentCommand,
  InventoryMutableProductRecord,
  InventoryRestockParams,
  InventoryRevertSaleParams,
  InventorySaleAdjustmentLogRecord,
  InventorySaleDeductionParams,
  InventoryStockChangeCommand,
  InventoryTransactionClient,
} from './inventory.types';
import {
  buildInventoryManualAdjustmentPlan,
  buildInventoryRevertStockPlan,
  buildInventoryStockChangePlan,
} from './inventory-stock.domain';

export async function executeInventoryManualAdjustment(
  transaction: InventoryTransactionClient,
  command: InventoryManualAdjustmentCommand,
): Promise<InventoryAdjustmentRecord> {
  const product = await findInventoryProductForStore(
    transaction,
    command.storeId,
    command.productId,
  );
  const plan = buildInventoryManualAdjustmentPlan({ product, command });

  await updateInventoryProductStock(
    transaction,
    plan.productId,
    plan.afterStock,
  );
  return createInventoryAdjustmentLog(transaction, plan.log);
}

export async function recordInventoryRestock(
  transaction: InventoryTransactionClient,
  params: InventoryRestockParams,
): Promise<void> {
  /*
   * BUG-8 修复：将串行 for 循环改为 Promise.all 并行处理，减少长事务风险。
   * 每个商品的库存更新和日志写入之间无依赖，可以安全并行。
   */
  await Promise.all(
    params.items.map((item) =>
      recordInventoryStockChange(transaction, {
        storeId: params.storeId,
        productId: item.productId,
        quantity: item.quantity,
        operatorStaffId: params.operatorStaffId,
        adjustType: 'restock',
        purchaseOrderId: params.purchaseOrderId,
      }),
    ),
  );
}

export async function recordInventorySaleDeduction(
  transaction: InventoryTransactionClient,
  params: InventorySaleDeductionParams,
): Promise<void> {
  /*
   * BUG-8 修复：将串行 for 循环改为 Promise.all 并行处理，减少长事务风险。
   */
  await Promise.all(
    params.items.map((item) =>
      recordInventoryStockChange(transaction, {
        storeId: params.storeId,
        productId: item.productId,
        quantity: item.quantity,
        operatorStaffId: params.operatorStaffId,
        adjustType: 'sale',
        saleOrderId: params.saleOrderId,
        note: '销售扣减',
      }),
    ),
  );
}

export async function revertInventorySaleDeduction(
  transaction: InventoryTransactionClient,
  params: InventoryRevertSaleParams,
): Promise<void> {
  /*
   * BUG-2 修复：先查日志、先删日志、再回滚库存。
   * 原逻辑是先回滚库存再删日志——如果删日志失败，库存已回滚，重复调用会导致库存虚增。
   * 改为先删日志再回滚：如果回滚失败，事务回滚，日志也不会丢，下次重试仍可正确回滚。
   */
  const logs = await querySaleAdjustmentLogs(transaction, params);

  if (logs.length === 0) {
    return;
  }

  await deleteSaleAdjustmentLogs(transaction, params);

  for (const log of logs) {
    const product = await findInventoryProductForStore(
      transaction,
      params.storeId,
      log.productId,
    );
    const plan = buildInventoryRevertStockPlan({
      product,
      delta: log.delta,
    });

    await updateInventoryProductStock(transaction, plan.productId, plan.stock);
  }
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
  stock: number,
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

async function recordInventoryStockChange(
  transaction: InventoryTransactionClient,
  command: InventoryStockChangeCommand,
): Promise<void> {
  const product = await findInventoryProductForStore(
    transaction,
    command.storeId,
    command.productId,
  );
  const plan = buildInventoryStockChangePlan({ product, command });

  await updateInventoryProductStock(
    transaction,
    plan.productId,
    plan.afterStock,
  );
  await createInventoryAdjustmentLog(transaction, plan.log);
}
