import type {
  InventoryAdjustmentLogCreateInput,
  InventoryAdjustmentRecord,
  InventoryDeductionParams,
  InventoryManualAdjustmentCommand,
  InventoryRestockParams,
  InventoryRevertLogRecord,
  InventoryRevertPurchaseParams,
  InventoryRevertSaleParams,
  InventorySaleDeductionParams,
  InventoryTransactionClient,
} from './inventory.types';
import { BadRequestException, ConflictException } from '@nestjs/common';
import type { InventoryAdjustType } from '@prisma/client';
import {
  buildInventoryManualAdjustmentPlan,
  buildInventoryRevertStockPlan,
  buildInventoryStockChangePlan,
} from './inventory-stock.domain';
import type { InventoryWriteContext } from './inventory-stock.query';
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
    /** 空间会话 ID：销售单尚未创建时先落，结账据此等值回填 saleOrderId */
    relatedSpaceSessionId?: number;
    /**
     * 商品被软删 / 不属于本门店时的语义：
     * 进货、销售等链路跳过（不应因库存记录缺失导致整单失败）；
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

  /*
   * 必须先加行锁（按 productId 升序）再读库存：
   * 下面的 buildInventoryStockChangePlan 依赖读到的 stock 做「可用库存不足」校验。
   * 无锁读时两个并发销售都基于同一份旧库存通过校验，后提交的 UPDATE 会把库存
   * 压成负数并撞 chk_products_stock_gte_0，返回的是数据库约束错误而不是
   * 前端能识别的「商品【xx】库存不足」。
   */
  const context = await loadInventoryWriteContext(
    transaction,
    params.storeId,
    mergedItems.map((item) => item.productId),
    { lockRows: true },
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
        relatedSpaceSessionId: params.relatedSpaceSessionId,
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
 * 一致性语义（all-or-nothing）：必须能**完整**撤销才允许删除。
 * 此前实现按可用库存钳制回滚量（库存不足就少扣、商品已删就跳过），
 * 但删单事务仍会删掉原流水与成本记录，结果是一次「部分撤销」既无法对账
 * 也无法反查——库存虚增、成本凭空消失。
 * 现在只要任一商品无法完整回滚，直接抛 409 让整笔删除失败，单据与流水保持原样。
 *
 * 顺序：先校验（一致性读 + 行锁）→ 删日志 → 批量回滚库存。
 * 校验阶段不写库，事务失败时日志与库存均不变，重复调用仍可安全重试。
 */
export async function revertInventoryPurchaseRestock(
  transaction: InventoryTransactionClient,
  params: InventoryRevertPurchaseParams,
): Promise<void> {
  const logs = await queryPurchaseAdjustmentLogs(transaction, params);

  if (logs.length === 0) {
    return;
  }

  // 回滚量由「当前库存 − 冻结量」推导，必须一致性读，否则并发下会把别人
  // 刚扣掉的库存重复加回（读到的 stock 偏大 → revertQty 偏大）。
  const context = await loadInventoryWriteContext(
    transaction,
    params.storeId,
    logs.map((log) => log.productId),
    { lockRows: true },
  );
  const purchaseRevertChanges = buildPurchaseRevertChanges(logs, context);

  await deletePurchaseAdjustmentLogs(transaction, params);
  await updateInventoryProductStocks(transaction, purchaseRevertChanges);
}

/**
 * 生成进货回滚的库存增量；无法完整撤销时抛 409。
 *
 * 两种不可撤销场景：
 * 1. 商品已被删除（软删后不再参与库存读）——回滚目标不存在；
 * 2. 可用库存（物理库存 − 客存冻结量）小于应回滚量——部分已售出或已冻结。
 */
function buildPurchaseRevertChanges(
  logs: InventoryRevertLogRecord[],
  context: InventoryWriteContext,
): Array<{ productId: number; delta: number }> {
  const changes: Array<{ productId: number; delta: number }> = [];

  for (const log of logs) {
    if (log.delta <= 0) {
      continue;
    }

    const product = context.products.get(log.productId);
    if (!product) {
      throw new ConflictException(
        `商品【${log.productName}】已删除或不可用，无法回滚库存，不能删除该进货单`,
      );
    }

    const frozenQty = context.frozenQty.get(log.productId) ?? 0;
    const availableStock = Math.max(0, product.stock - frozenQty);

    if (availableStock < log.delta) {
      throw new ConflictException(
        `商品【${product.name}】可用库存 ${availableStock} 小于应回滚数量 ${log.delta}（部分已售出或已冻结），无法完整撤销该进货单`,
      );
    }

    changes.push({ productId: product.id, delta: -log.delta });
  }

  return changes;
}

export { deductInventoryForSaleBestEffort } from './inventory-stock-best-effort.write';

/**
 * 服务内库存扣减：在调用方既有事务中批量扣减库存并写入流水（供空间管理等业务复用）。
 *
 * `relatedSpaceSessionId` 是结账回填的等值定位键：空间追加点单扣库存时销售单还没创建，
 * 先落会话 ID，结账按本列回填 saleOrderId，不再依赖 note 字符串拼接。
 */
export async function applyInventoryDeductionsInTransaction(
  params: InventoryDeductionParams,
): Promise<void> {
  await recordInventoryStockChanges(params.transaction, {
    storeId: params.storeId,
    items: params.items,
    operatorStaffId: params.operatorStaffId,
    adjustType: params.adjustType,
    note: params.note,
    relatedSpaceSessionId: params.relatedSpaceSessionId,
    onMissingProduct: 'throw',
  });
}
