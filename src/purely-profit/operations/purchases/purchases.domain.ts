import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  buildPreviousPurchaseDateRange,
  buildPurchaseDateRange,
  toOptionalText,
} from '../../commerce/commerce.utils';
import type {
  PreparedPurchaseItem,
  PurchaseCreateItemInput,
  PurchaseListQuery,
  PurchaseProductRecord,
  PurchaseStatsQuery,
} from './purchases.types';

export function buildPurchaseListWhere(
  storeId: number,
  query: PurchaseListQuery,
): Prisma.PurchaseOrderWhereInput {
  const dateRange = buildPurchaseDateRange(
    query.period,
    query.customDate,
    query.rangeStartDate,
    query.rangeEndDate,
  );

  return {
    storeId,
    ...(dateRange ? { date: dateRange } : {}),
  };
}

export function resolvePurchaseStatsRanges(
  storeId: number,
  query: PurchaseStatsQuery,
): {
  currentWhere: Prisma.PurchaseOrderWhereInput;
  previousRange?: { gte: Date; lte: Date };
} {
  const currentRange = buildPurchaseDateRange(
    query.period,
    query.customDate,
    query.rangeStartDate,
    query.rangeEndDate,
  );

  return {
    currentWhere: {
      storeId,
      ...(currentRange ? { date: currentRange } : {}),
    },
    previousRange: buildPreviousPurchaseDateRange(currentRange),
  };
}

export function normalizePurchaseSupplierName(
  supplierName?: string,
): string | null {
  return toOptionalText(supplierName) ?? null;
}

export function normalizePurchaseNote(note?: string): string | null {
  return toOptionalText(note) ?? null;
}

export function assertPurchaseSupplierInput(
  supplierId: number | undefined,
  supplierName: string | null,
): void {
  if (!supplierId && !supplierName) {
    throw new BadRequestException('请选择供应商或填写供应商名称');
  }
}

export function extractUniqueProductIds(
  items: PurchaseCreateItemInput[],
): number[] {
  const productIds = items
    .map((item) => item.productId)
    .filter((productId): productId is number => productId !== undefined);
  const uniqueProductIds = Array.from(new Set(productIds));

  if (uniqueProductIds.length !== productIds.length) {
    throw new ConflictException('同一商品请合并成一条进货明细');
  }

  return uniqueProductIds;
}

export function createPurchaseProductMap(
  products: PurchaseProductRecord[],
  expectedProductIds: number[],
): Map<number, PurchaseProductRecord> {
  const productMap = new Map<number, PurchaseProductRecord>(
    products.map((item) => [item.id, item]),
  );

  if (productMap.size !== expectedProductIds.length) {
    throw new NotFoundException('存在无效商品');
  }

  return productMap;
}

export function preparePurchaseItems(
  items: PurchaseCreateItemInput[],
  productMap: Map<number, PurchaseProductRecord>,
): PreparedPurchaseItem[] {
  return items.map((item) => preparePurchaseItem(item, productMap));
}

export function sumPreparedPurchaseAmount(items: PreparedPurchaseItem[]): number {
  return Number(items.reduce((sum, item) => sum + item.amount, 0).toFixed(2));
}

export function buildPurchaseCostTitle(supplierName?: string | null): string {
  return supplierName ? `${supplierName}进货成本` : '进货成本';
}

export function calculatePurchaseCompareLastMonth(
  currentTotal: number,
  previousTotal: number,
  hasPreviousRange: boolean,
): number | null {
  if (!hasPreviousRange || previousTotal <= 0) {
    return null;
  }

  return Number(
    (((currentTotal - previousTotal) / previousTotal) * 100).toFixed(2),
  );
}

function preparePurchaseItem(
  item: PurchaseCreateItemInput,
  productMap: Map<number, PurchaseProductRecord>,
): PreparedPurchaseItem {
  const product =
    item.productId !== undefined ? productMap.get(item.productId) : undefined;

  if (item.productId !== undefined && !product) {
    throw new NotFoundException('存在无效商品');
  }
  if (!Number.isFinite(item.unitPrice) || item.unitPrice < 0) {
    throw new BadRequestException('进货单价不能为负数');
  }

  const productName = toOptionalText(item.productName) ?? product?.name;
  if (!productName) {
    throw new BadRequestException('无码商品必须填写商品名称');
  }

  return {
    productId: product?.id ?? null,
    productName,
    unit: toOptionalText(item.unit) ?? product?.unit ?? null,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    amount: Number((item.quantity * item.unitPrice).toFixed(2)),
  };
}
