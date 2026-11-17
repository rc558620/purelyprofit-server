// 尽力而为的销售扣减：库存不足时只扣到 0，不抛异常、不产生负库存
import type {
  InventoryAdjustmentLogCreateInput,
  InventoryTransactionClient,
} from './inventory.types';
import {
  createInventoryAdjustmentLogs,
  loadInventoryWriteContext,
  updateInventoryProductStocks,
} from './inventory-stock.query';
import { mergeInventoryItemsByProductId } from './inventory-stock-merge.shared';

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
  if (mergedItems.length === 0) {
    return;
  }

  const context = await loadInventoryWriteContext(
    transaction,
    storeId,
    mergedItems.map((item) => item.productId),
  );
  const logs: InventoryAdjustmentLogCreateInput[] = [];
  const bestEffortChanges: Array<{ productId: number; delta: number }> = [];

  for (const item of mergedItems) {
    const product = context.products.get(item.productId);
    // 商品被删除/不属于该门店：无库存可扣，跳过而非中断落账
    if (!product) continue;

    // 客存冻结：只按可用库存扣减（物理库存 − 在存冻结量），不得卖掉客户寄存的商品
    const availableStock = Math.max(
      0,
      product.stock - (context.frozenQty.get(item.productId) ?? 0),
    );
    const shortOf = item.quantity - availableStock;
    const deducted = Math.min(item.quantity, availableStock);
    // 可用库存已为 0：没有任何可扣量，不产生 delta=0 的流水噪音
    if (deducted <= 0) continue;

    const afterStock = product.stock - deducted;
    bestEffortChanges.push({ productId: product.id, delta: -deducted });
    logs.push({
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

  await updateInventoryProductStocks(transaction, bestEffortChanges);
  await createInventoryAdjustmentLogs(transaction, logs);
}
