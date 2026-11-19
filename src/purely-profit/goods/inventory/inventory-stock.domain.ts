import { BadRequestException, NotFoundException } from '@nestjs/common';
import { INVENTORY_STOCK_LIMIT } from '../../commerce/commerce.utils';
import type {
  InventoryAdjustedStockParams,
  InventoryAdjustmentLogCreateInput,
  InventoryManualAdjustmentCommand,
  InventoryMutableProductRecord,
  InventoryRevertStockPlan,
  InventoryStockChangeCommand,
  InventoryStockMutationPlan,
} from './inventory.types';

export function resolveAdjustedStock(
  params: InventoryAdjustedStockParams,
): number {
  if (params.mode === 'set') {
    /* typeof 同时挡住 undefined 与 null：null 不是「没传目标库存」，而是非法入参 */
    if (typeof params.targetStock !== 'number') {
      throw new BadRequestException('set 模式下必须传目标库存');
    }
    return assertInventoryStockInRange(params.targetStock);
  }

  const result = params.currentStock + (params.delta ?? 0);

  /* BUG-3: delta 模式下结果为负数时拒绝，而非静默截断到 0 */
  if (result < 0) {
    throw new BadRequestException('库存调整后不能为负数');
  }

  return assertInventoryStockInRange(result);
}

/**
 * 库存数量必须落在 [0, INVENTORY_STOCK_LIMIT] 内。
 *
 * 库存列是 32 位 Int，超界入参（或极值累加）只会在写库时抛出 Prisma 校验错误，
 * 变成一个用户看不懂的 500；这里提前拦截并给出明确的 400。
 */
function assertInventoryStockInRange(stock: number): number {
  if (!Number.isSafeInteger(stock) || stock > INVENTORY_STOCK_LIMIT) {
    throw new BadRequestException(
      `库存数量超出允许范围（上限 ${INVENTORY_STOCK_LIMIT}）`,
    );
  }

  return stock;
}

/**
 * 人工调整的方向校验。
 *
 * 必须在拿到行锁、算出真实变动量之后调用，而不是只看入参的 delta：
 * set 模式按「目标库存 − 当前库存」得到实际方向，同样要拦住
 * 「进货入库却是减少」「损耗报废却是增加」这类会让按类型汇总失真的流水。
 */
export function assertInventoryManualAdjustDirection(
  adjustType: InventoryAdjustmentLogCreateInput['adjustType'],
  delta: number,
): void {
  if (adjustType === 'restock' && delta <= 0) {
    throw new BadRequestException('进货入库的数量必须为正数');
  }

  if (adjustType === 'damage' && delta >= 0) {
    throw new BadRequestException('损耗/报废的数量必须为负数');
  }
}

export function buildInventoryManualAdjustmentPlan(params: {
  product: InventoryMutableProductRecord | null;
  command: InventoryManualAdjustmentCommand;
}): InventoryStockMutationPlan {
  const product = ensureInventoryProductExists(params.product);
  const afterStock = resolveAdjustedStock({
    currentStock: product.stock,
    delta: params.command.delta,
    targetStock: params.command.targetStock,
    mode: params.command.mode,
  });

  /*
   * 两种模式下都不允许产生 delta=0 的空流水：
   * service 层只能拦住显式传 delta=0，set 模式下 targetStock 等于当前库存的情况
   * 必须到这里（已读到 product.stock）才能判定。
   * inventory_adjustment_logs 是只增不删的大表，无效流水会长期占用存储并干扰盘点对账。
   */
  if (afterStock === product.stock) {
    throw new BadRequestException('调整后库存与当前库存一致，无需调整');
  }

  /*
   * 方向校验放在这里（已获得行锁、已算出真实变动量），两种模式都会被覆盖：
   * 只校验入参 delta 时，set 模式可以生成「进货 -8」「报损 +5」的流水，
   * 而流水会按 adjustType 汇总，方向相反的记录会直接污染进货量与损耗量。
   */
  assertInventoryManualAdjustDirection(
    params.command.adjustType,
    afterStock - product.stock,
  );

  return {
    productId: product.id,
    afterStock,
    log: buildInventoryAdjustmentLogCreateInput({
      storeId: params.command.storeId,
      product,
      operatorStaffId: params.command.operatorStaffId,
      afterStock,
      delta: afterStock - product.stock,
      adjustType: params.command.adjustType,
      note: params.command.note,
    }),
  };
}

export function buildInventoryStockChangePlan(params: {
  product: InventoryMutableProductRecord | null;
  command: InventoryStockChangeCommand;
  /** 客存在存冻结量（frozen 口径）：不传视为 0，未开启客存冻结的门店行为完全不变 */
  frozenQty?: number;
}): InventoryStockMutationPlan {
  const product = ensureInventoryProductExists(params.product);
  const frozenQty = Math.max(0, params.frozenQty ?? 0);
  const delta =
    params.command.adjustType === 'sale'
      ? -params.command.quantity
      : params.command.quantity;
  const afterStock = product.stock + delta;

  /*
   * 客存冻结：物理库存里有货不等于可卖。
   * 可用库存 = 物理库存 − 在存冻结量，扣减后仍须保证可用库存不为负，
   * 否则会把客户寄存的商品卖掉。frozenQty 为 0 时本分支与历史行为一致（afterStock < 0）。
   */
  const afterAvailableStock = afterStock - frozenQty;
  if (afterAvailableStock < 0) {
    throw new BadRequestException(
      frozenQty > 0
        ? `商品【${product.name}】可用库存不足（可用 ${Math.max(0, product.stock - frozenQty)}，其中客存冻结 ${frozenQty}）`
        : `商品【${product.name}】库存不足`,
    );
  }

  return {
    productId: product.id,
    afterStock,
    log: buildInventoryAdjustmentLogCreateInput({
      storeId: params.command.storeId,
      product,
      operatorStaffId: params.command.operatorStaffId,
      afterStock,
      delta,
      adjustType: params.command.adjustType,
      note: params.command.note,
      purchaseOrderId: params.command.purchaseOrderId,
      saleOrderId: params.command.saleOrderId,
      relatedSpaceSessionId: params.command.relatedSpaceSessionId,
    }),
  };
}

export function buildInventoryRevertStockPlan(params: {
  product: InventoryMutableProductRecord | null;
  delta: number;
}): InventoryRevertStockPlan {
  const product = ensureInventoryProductExists(params.product);

  /*
   * BUG-2 修复：回滚库存 = 当前库存 - 日志 delta。
   * 销售 delta 为负数（如 -4），回滚后 stock - (-4) = stock + 4，方向正确。
   * 如果 delta 为正数（异常数据），stock - delta 会让库存减少，相当于撤销补货，语义也正确。
   */
  return {
    productId: product.id,
    stock: product.stock - params.delta,
  };
}

function ensureInventoryProductExists(
  product: InventoryMutableProductRecord | null,
): InventoryMutableProductRecord {
  if (!product) {
    throw new NotFoundException('商品不存在');
  }

  return product;
}

function buildInventoryAdjustmentLogCreateInput(params: {
  storeId: number;
  product: InventoryMutableProductRecord;
  operatorStaffId: number | null;
  afterStock: number;
  delta: number;
  adjustType: InventoryAdjustmentLogCreateInput['adjustType'];
  note?: string;
  purchaseOrderId?: number;
  saleOrderId?: number;
  relatedSpaceSessionId?: number;
}): InventoryAdjustmentLogCreateInput {
  return {
    storeId: params.storeId,
    productId: params.product.id,
    operatorStaffId: params.operatorStaffId,
    productName: params.product.name,
    beforeStock: params.product.stock,
    afterStock: params.afterStock,
    delta: params.delta,
    adjustType: params.adjustType,
    ...(params.note !== undefined ? { note: params.note } : {}),
    ...(params.purchaseOrderId !== undefined
      ? { purchaseOrderId: params.purchaseOrderId }
      : {}),
    ...(params.saleOrderId !== undefined
      ? { saleOrderId: params.saleOrderId }
      : {}),
    ...(params.relatedSpaceSessionId !== undefined
      ? { relatedSpaceSessionId: params.relatedSpaceSessionId }
      : {}),
  };
}
