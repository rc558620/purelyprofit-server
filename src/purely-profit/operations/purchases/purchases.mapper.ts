import {
  buildPaginationMeta,
  toDecimalNumber,
  toTimestampMs,
} from '../../commerce/commerce.utils';
import type {
  PaginatedPurchasesResponseDto,
  PurchaseItemResponseDto,
  PurchaseResponseDto,
  PurchaseStatsResponseDto,
} from './dto/purchase.dto';
import { calculatePurchaseCompareLastMonth } from './purchases.domain';
import type {
  PurchaseOrderItemWithAmounts,
  PurchaseOrderWithItems,
} from './purchases.types';

export function buildEmptyPaginatedPurchasesResponse(
  page: number,
  pageSize: number,
): PaginatedPurchasesResponseDto {
  return {
    items: [],
    meta: buildPaginationMeta(0, page, pageSize),
  };
}

export function buildPaginatedPurchasesResponse(
  orders: PurchaseOrderWithItems[],
  page: number,
  pageSize: number,
  total: number,
): PaginatedPurchasesResponseDto {
  return {
    items: orders.map((order) => mapPurchaseResponse(order)),
    meta: buildPaginationMeta(total, page, pageSize),
  };
}

export function buildEmptyPurchaseStatsResponse(): PurchaseStatsResponseDto {
  return {
    totalThisMonth: 0,
    countThisMonth: 0,
    supplierCount: 0,
    compareLastMonth: null,
  };
}

export function buildPurchaseStatsResponse(params: {
  supplierCount: number;
  currentCount: number;
  currentTotalAmount: { toString(): string } | null;
  previousTotalAmount: { toString(): string } | null;
  hasPreviousRange: boolean;
}): PurchaseStatsResponseDto {
  const currentTotal = toDecimalNumber(params.currentTotalAmount);
  const previousTotal = toDecimalNumber(params.previousTotalAmount);

  return {
    totalThisMonth: currentTotal,
    countThisMonth: params.currentCount,
    supplierCount: params.supplierCount,
    compareLastMonth: calculatePurchaseCompareLastMonth(
      currentTotal,
      previousTotal,
      params.hasPreviousRange,
    ),
  };
}

export function mapPurchaseResponse(
  order: PurchaseOrderWithItems,
): PurchaseResponseDto {
  return {
    id: String(order.id),
    ...(order.supplierId ? { supplierId: String(order.supplierId) } : {}),
    ...(order.supplierName ? { supplierName: order.supplierName } : {}),
    items: order.items.map((item) => mapPurchaseItemResponse(item)),
    totalAmount: toDecimalNumber(order.totalAmount),
    date: toTimestampMs(order.date),
    ...(order.note ? { note: order.note } : {}),
    createdAt: toTimestampMs(order.createdAt),
  };
}

function mapPurchaseItemResponse(
  item: PurchaseOrderItemWithAmounts,
): PurchaseItemResponseDto {
  return {
    id: String(item.id),
    ...(item.productId ? { productId: String(item.productId) } : {}),
    productName: item.productName,
    ...(item.unit ? { unit: item.unit } : {}),
    quantity: item.quantity,
    unitPrice: toDecimalNumber(item.unitPrice),
    amount: toDecimalNumber(item.amount),
  };
}
