import {
  buildPaginationMeta,
  toTimestampMs,
} from '../../commerce/commerce.utils';
import { Money } from '../../../shared/money.utils';
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
    totalAmount: 0,
    orderCount: 0,
    supplierCount: 0,
    compareLastPeriod: null,
  };
}

export function buildPurchaseStatsResponse(params: {
  supplierCount: number;
  currentCount: number;
  currentTotalAmount: number | null;
  previousTotalAmount: number | null;
  hasPreviousRange: boolean;
}): PurchaseStatsResponseDto {
  const currentTotal = Money.fromDbCents(params.currentTotalAmount ?? 0).toOutputYuan();
  const previousTotal = Money.fromDbCents(params.previousTotalAmount ?? 0).toOutputYuan();

  return {
    totalAmount: currentTotal,
    orderCount: params.currentCount,
    supplierCount: params.supplierCount,
    compareLastPeriod: calculatePurchaseCompareLastMonth(
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
    totalAmount: Money.fromDbCents(order.totalAmount).toOutputYuan(),
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
    unitPrice: Money.fromDbCents(item.unitPrice).toOutputYuan(),
    amount: Money.fromDbCents(item.amount).toOutputYuan(),
  };
}
