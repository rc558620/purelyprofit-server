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
import type { InventoryAdjustType } from '@prisma/client';
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

  /*
   * D2 修复：delta 模式使用原子 increment 替代绝对赋值，
   * 防止并发请求各自读旧值后计算绝对新值导致丢失更新。
   * set 模式仍使用绝对赋值（语义上必须）。
   */
  if (command.mode === 'set') {
    await updateInventoryProductStock(
      transaction,
      plan.productId,
      plan.afterStock,
    );
  } else {
    const delta = plan.afterStock - (product?.stock ?? 0);
    await updateInventoryProductStock(transaction, plan.productId, {
      increment: delta,
    });
  }
  return createInventoryAdjustmentLog(transaction, plan.log);
}

/**
 * 按 productId 合并商品行，将相同 productId 的 quantity 累加。
 * 防止并行处理时相同商品的多条记录产生 read-modify-write 竞态。
 */
function mergeInventoryItemsByProductId<
  T extends { productId: number; quantity: number; productName?: string },
>(items: T[]): T[] {
  const map = new Map<number, T>();
  for (const item of items) {
    const existing = map.get(item.productId);
    if (existing) {
      existing.quantity += item.quantity;
    } else {
      map.set(item.productId, { ...item });
    }
  }
  return Array.from(map.values());
}

export async function recordInventoryRestock(
  transaction: InventoryTransactionClient,
  params: InventoryRestockParams,
): Promise<void> {
  /*
   * BUG-1 修复：先按 productId 合并相同商品，再顺序处理，
   * 避免并行 read-modify-write 导致后写覆盖前写的库存丢失问题。
   */
  const mergedItems = mergeInventoryItemsByProductId(params.items);
  for (const item of mergedItems) {
    await recordInventoryStockChange(transaction, {
      storeId: params.storeId,
      productId: item.productId,
      quantity: item.quantity,
      operatorStaffId: params.operatorStaffId,
      adjustType: 'restock',
      purchaseOrderId: params.purchaseOrderId,
    });
  }
}

export async function recordInventorySaleDeduction(
  transaction: InventoryTransactionClient,
  params: InventorySaleDeductionParams,
): Promise<void> {
  /*
   * BUG-1 修复：先按 productId 合并相同商品，再顺序处理，
   * 避免并行 read-modify-write 导致后写覆盖前写的库存丢失问题。
   */
  const mergedItems = mergeInventoryItemsByProductId(params.items);
  for (const item of mergedItems) {
    await recordInventoryStockChange(transaction, {
      storeId: params.storeId,
      productId: item.productId,
      quantity: item.quantity,
      operatorStaffId: params.operatorStaffId,
      adjustType: 'sale',
      saleOrderId: params.saleOrderId,
      note: '销售扣减',
    });
  }
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

    /*
     * D2 修复：回滚使用原子 increment(-delta)，而非读后写绝对值，
     * 防止并发回滚时后提交覆盖先提交导致库存数据丢失。
     * 销售 delta 为负（如 -4），increment(-(-4)) = increment(4)，方向正确。
     */
    await updateInventoryProductStock(transaction, plan.productId, {
      increment: -log.delta,
    });
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

  /*
   * D2 修复：使用原子 increment 替代绝对赋值，
   * sale 扣减时 increment(-quantity)，restock 补货时 increment(+quantity)。
   */
  const delta =
    command.adjustType === 'sale' ? -command.quantity : command.quantity;
  await updateInventoryProductStock(transaction, plan.productId, {
    increment: delta,
  });
  await createInventoryAdjustmentLog(transaction, plan.log);
}

/**
 * 尽力而为的销售扣减：库存不足时只扣到 0，不抛异常、不产生负库存。
 *
 * 与 applyInventoryDeductionsInTransaction 的区别在于失败语义：后者发现商品
 * 不存在或库存不足会抛异常，用于「员工在商家端主动操作、可以让操作失败」的场景
 * （如空间管理追加点单）。而「会员自助下单支付回调落账」这类场景资金流水已经发生，
 * 一旦因库存不足回滚事务，就会出现「钱已收、账单未入账」的资金事故；
 * 门店未维护库存（stock 恒为 0）时同理不应阻断入账。
 *
 * 因此这里按可用库存扣减（clamp 到 0），并把差额写入日志备注以便复盘。
 */
export async function deductInventoryForSaleBestEffort(
  transaction: InventoryTransactionClient,
  items: Array<{ productId: number; quantity: number; productName?: string }>,
  storeId: number,
  operatorStaffId: number | null,
  note?: string,
): Promise<void> {
  const mergedItems = mergeInventoryItemsByProductId(items);
  for (const item of mergedItems) {
    const product = await findInventoryProductForStore(
      transaction,
      storeId,
      item.productId,
    );
    // 商品被删除/不属于该门店：无库存可扣，跳过而非中断落账
    if (!product) continue;

    const shortOf = item.quantity - product.stock;
    const deducted = Math.min(item.quantity, product.stock);
    // 库存已为 0：没有任何可扣量，不产生 delta=0 的流水噪音
    if (deducted <= 0) continue;

    const afterStock = product.stock - deducted;
    await updateInventoryProductStock(transaction, product.id, {
      increment: -deducted,
    });
    await createInventoryAdjustmentLog(transaction, {
      storeId,
      productId: product.id,
      operatorStaffId,
      productName: product.name,
      beforeStock: product.stock,
      afterStock,
      delta: -deducted,
      adjustType: 'sale',
      note:
        shortOf > 0
          ? `${note ?? '销售扣减'}（库存不足 ${shortOf}，按可用库存扣至 0）`
          : (note ?? '销售扣减'),
    });
  }
}

/**
 * 服务内库存扣减：支持在现有事务中批量扣减库存并写入日志（供空间管理等业务复用）
 * @param transaction 既有 Prisma 事务
 * @param items 待扣减的商品列表
 * @param storeId 门店 ID
 * @param operatorStaffId 操作者员工 ID
 * @param adjustType 调整类型
 * @param note 备注
 */
export async function applyInventoryDeductionsInTransaction(
  transaction: InventoryTransactionClient,
  items: Array<{ productId: number; quantity: number; productName?: string }>,
  storeId: number,
  operatorStaffId: number | null,
  adjustType: InventoryAdjustType,
  note?: string,
): Promise<void> {
  /*
   * BUG-1 修复：先按 productId 合并相同商品，再顺序处理，
   * 避免并行 read-modify-write 导致后写覆盖前写的库存丢失问题。
   */
  const mergedItems = mergeInventoryItemsByProductId(items);
  for (const item of mergedItems) {
    const product = await findInventoryProductForStore(
      transaction,
      storeId,
      item.productId,
    );
    if (!product) {
      throw new Error(
        `商品【${item.productName || item.productId}】不存在或无权访问`,
      );
    }

    const plan = buildInventoryStockChangePlan({
      product,
      command: {
        storeId,
        productId: item.productId,
        quantity: item.quantity,
        operatorStaffId,
        adjustType,
        note,
      },
    });

    await updateInventoryProductStock(transaction, plan.productId, {
      increment: item.quantity * (adjustType === 'sale' ? -1 : 1),
    });
    await createInventoryAdjustmentLog(transaction, plan.log);
  }
}
