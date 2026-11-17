import type {
  InventoryAdjustmentLogCreateInput,
  InventoryAdjustmentRecord,
  InventoryManualAdjustmentCommand,
  InventoryRestockParams,
  InventoryRevertPurchaseParams,
  InventoryRevertSaleParams,
  InventorySaleDeductionParams,
  InventoryTransactionClient,
} from './inventory.types';
import { BadRequestException } from '@nestjs/common';
import type { InventoryAdjustType } from '@prisma/client';
import {
  buildInventoryManualAdjustmentPlan,
  buildInventoryRevertStockPlan,
  buildInventoryStockChangePlan,
} from './inventory-stock.domain';
import {
  createInventoryAdjustmentLog,
  createInventoryAdjustmentLogs,
  deletePurchaseAdjustmentLogs,
  deleteSaleAdjustmentLogs,
  loadInventoryWriteContext,
  lockAndFindInventoryProductRow,
  queryPurchaseAdjustmentLogs,
  querySaleAdjustmentLogs,
  resolveFrozenQty,
  updateInventoryProductStock,
  updateInventoryProductStocks,
} from './inventory-stock.query';
import { mergeInventoryItemsByProductId } from './inventory-stock-merge.shared';

/**
 * 库存写路径的编排层：只决定「加锁 → 读库存 → 校验 → 改库存 → 写流水」的次序，
 * 具体的 SQL 一律在 inventory-stock.query.ts，纯计算在 inventory-stock.domain.ts。
 *
 * 每个导出函数对应一个业务场景（盘点调整、进货入库、销售扣减、单据回滚、
 * 外部模块复用扣减），所有函数都显式接收调用方的事务 client：库存必须与
 * 销售额入账、进货单落库等主链路同事务提交 / 回滚。
 */

export async function executeInventoryManualAdjustment(
  transaction: InventoryTransactionClient,
  command: InventoryManualAdjustmentCommand,
): Promise<InventoryAdjustmentRecord> {
  /*
   * set/delta 两种模式都是 read-modify-write：先读 stock 算新值再写回。
   * Read Committed 下两个并发调整会各自基于同一份旧 stock 计算，最后的 UPDATE 覆盖前者，
   * 于是账面只涨了一次、日志却记了两条 delta，beforeStock 也全是旧值，盘点对账直接错乱。
   * 盘点恰恰是多人同时提交的高并发场景，这里先取行锁把并发请求串行化。
   */
  // 加锁与读库存合并为一次往返：锁必须在读之前拿到，否则读到的仍是未串行化的旧值
  const product = await lockAndFindInventoryProductRow(
    transaction,
    command.storeId,
    command.productId,
  );
  const plan = buildInventoryManualAdjustmentPlan({ product, command });

  /*
   * 客存冻结兜底：物理库存不允许被改到低于「在存冻结量」。
   * 否则会出现「冻结量 > 物理库存」的脏数据，可用库存被静默截断为 0、商品无法销售，
   * 且没有任何日志或告警可追溯。delta 模式（报损 / 盘点减量）同样按调整后的库存校验。
   */
  const frozenQty = await resolveFrozenQty(
    transaction,
    command.storeId,
    command.productId,
  );
  if (plan.afterStock < frozenQty) {
    throw new BadRequestException(
      `调整后库存 ${plan.afterStock} 低于该商品的客存冻结量 ${frozenQty}，请先处理在存的客存单`,
    );
  }

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

export async function recordInventoryRestock(
  transaction: InventoryTransactionClient,
  params: InventoryRestockParams,
): Promise<void> {
  await recordInventoryStockChanges(transaction, {
    storeId: params.storeId,
    items: params.items,
    operatorStaffId: params.operatorStaffId,
    adjustType: 'restock',
    purchaseOrderId: params.purchaseOrderId,
    onMissingProduct: 'skip',
  });
}

export async function recordInventorySaleDeduction(
  transaction: InventoryTransactionClient,
  params: InventorySaleDeductionParams,
): Promise<void> {
  await recordInventoryStockChanges(transaction, {
    storeId: params.storeId,
    items: params.items,
    operatorStaffId: params.operatorStaffId,
    adjustType: 'sale',
    saleOrderId: params.saleOrderId,
    note: '销售扣减',
    onMissingProduct: 'skip',
  });
}

/**
 * 批量库存变更：一次读出全部商品行与冻结量，再逐条改库存、最后一次性写流水。
 *
 * 写仍是逐条原子 increment（并发语义不变），只有「读」与「流水写入」被批量化：
 * 5 个商品的订单从 20 次事务内往返降到 8 次（2 读 + 5 更新 + 1 流水）。
 */
async function recordInventoryStockChanges(
  transaction: InventoryTransactionClient,
  params: {
    storeId: number;
    items: Array<{ productId: number; quantity: number; productName?: string }>;
    operatorStaffId: number | null;
    adjustType: InventoryAdjustType;
    note?: string;
    purchaseOrderId?: number;
    saleOrderId?: number;
    /**
     * 商品被软删 / 不属于本门店时的语义：
     * 进货、销售等主链路跳过（不应因库存记录缺失导致整单失败）；
     * 空间管理等复用路径要让操作失败。
     */
    onMissingProduct: 'skip' | 'throw';
  },
): Promise<void> {
  /*
   * BUG-1 修复：先按 productId 合并相同商品，再顺序处理，
   * 避免并行 read-modify-write 导致后写覆盖前写的库存丢失问题。
   */
  const mergedItems = mergeInventoryItemsByProductId(params.items);
  if (mergedItems.length === 0) {
    return;
  }

  const context = await loadInventoryWriteContext(
    transaction,
    params.storeId,
    mergedItems.map((item) => item.productId),
  );

  const logs: InventoryAdjustmentLogCreateInput[] = [];
  const stockChanges: Array<{ productId: number; delta: number }> = [];

  for (const item of mergedItems) {
    const product = context.products.get(item.productId);
    if (!product) {
      if (params.onMissingProduct === 'throw') {
        throw new Error(
          `商品【${item.productName || item.productId}】不存在或无权访问`,
        );
      }
      continue;
    }

    const plan = buildInventoryStockChangePlan({
      product,
      command: {
        storeId: params.storeId,
        productId: item.productId,
        quantity: item.quantity,
        operatorStaffId: params.operatorStaffId,
        adjustType: params.adjustType,
        note: params.note,
        purchaseOrderId: params.purchaseOrderId,
        saleOrderId: params.saleOrderId,
      },
      frozenQty: context.frozenQty.get(item.productId) ?? 0,
    });

    /*
     * D2 修复：使用原子 increment 替代绝对赋值，
     * sale 扣减时 increment(-quantity)，restock 补货时 increment(+quantity)。
     * 这里先收集再一次性批量 UPDATE——delta 由数据库侧在行上做加法，
     * 并发语义与逐个 update 完全一致，但事务内往返从 N 次降为 1 次。
     */
    stockChanges.push({
      productId: plan.productId,
      delta: params.adjustType === 'sale' ? -item.quantity : item.quantity,
    });
    logs.push(plan.log);
  }

  await updateInventoryProductStocks(transaction, stockChanges);
  await createInventoryAdjustmentLogs(transaction, logs);
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

  const context = await loadInventoryWriteContext(
    transaction,
    params.storeId,
    logs.map((log) => log.productId),
  );

  /*
   * 与 recordInventoryStockChanges 同理：先收集 delta，再一次性批量 UPDATE，
   * 避免回滚一张十几行的销售单时在事务里跑十几趟往返。
   */
  const revertChanges: Array<{ productId: number; delta: number }> = [];

  for (const log of logs) {
    const plan = buildInventoryRevertStockPlan({
      product: context.products.get(log.productId) ?? null,
      delta: log.delta,
    });

    /*
     * D2 修复：回滚使用原子 increment(-delta)，而非读后写绝对值，
     * 防止并发回滚时后提交覆盖先提交导致库存数据丢失。
     * 销售 delta 为负（如 -4），increment(-(-4)) = increment(4)，方向正确。
     */
    revertChanges.push({ productId: plan.productId, delta: -log.delta });
  }

  await updateInventoryProductStocks(transaction, revertChanges);
}

/**
 * 进货单删除时的入库回滚：按该进货单产生的 restock 日志反向扣减库存。
 *
 * 与 revertInventorySaleDeduction 同序（先删日志、再回滚库存）：
 * 先删日志可保证幂等——重复调用第二次查不到日志，不会重复回滚；
 * 若回滚途中失败，事务整体回滚、日志也不会丢，下次重试仍能正确扣减。
 *
 * 库存语义：只回滚「可用库存」（物理库存 − 客存冻结量）并钳制到 0，
 * 避免出现负库存或把客户寄存的商品回滚掉。
 */
export async function revertInventoryPurchaseRestock(
  transaction: InventoryTransactionClient,
  params: InventoryRevertPurchaseParams,
): Promise<void> {
  const logs = await queryPurchaseAdjustmentLogs(transaction, params);

  if (logs.length === 0) {
    return;
  }

  await deletePurchaseAdjustmentLogs(transaction, params);

  const context = await loadInventoryWriteContext(
    transaction,
    params.storeId,
    logs.map((log) => log.productId),
  );

  const purchaseRevertChanges: Array<{ productId: number; delta: number }> = [];

  for (const log of logs) {
    const product = context.products.get(log.productId);
    if (!product) continue;

    const frozenQty = context.frozenQty.get(log.productId) ?? 0;
    const availableStock = Math.max(0, product.stock - frozenQty);
    const revertQty = Math.min(Math.max(0, log.delta), availableStock);
    if (revertQty <= 0) continue;

    purchaseRevertChanges.push({ productId: product.id, delta: -revertQty });
  }

  await updateInventoryProductStocks(transaction, purchaseRevertChanges);
}

export { deductInventoryForSaleBestEffort } from './inventory-stock-best-effort.write';

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
  await recordInventoryStockChanges(transaction, {
    storeId,
    items,
    operatorStaffId,
    adjustType,
    note,
    onMissingProduct: 'throw',
  });
}
