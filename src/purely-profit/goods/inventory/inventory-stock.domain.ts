import { BadRequestException, NotFoundException } from '@nestjs/common';
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
    if (params.targetStock === undefined) {
      throw new BadRequestException('set 模式下必须传目标库存');
    }
    return params.targetStock;
  }

  return Math.max(0, params.currentStock + (params.delta ?? 0));
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
}): InventoryStockMutationPlan {
  const product = ensureInventoryProductExists(params.product);
  const delta =
    params.command.adjustType === 'sale'
      ? -params.command.quantity
      : params.command.quantity;
  const afterStock = product.stock + delta;

  if (afterStock < 0) {
    throw new BadRequestException(`商品【${product.name}】库存不足`);
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
    }),
  };
}

export function buildInventoryRevertStockPlan(params: {
  product: InventoryMutableProductRecord | null;
  delta: number;
}): InventoryRevertStockPlan {
  const product = ensureInventoryProductExists(params.product);

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
  };
}
