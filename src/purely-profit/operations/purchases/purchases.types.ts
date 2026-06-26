import type { Prisma } from '@prisma/client';
import type { PurchasePeriodValue } from '../../commerce/commerce.utils';
import type { CreatePurchaseDto } from './dto/purchase.dto';

export interface PurchaseListQuery {
  storeId?: number;
  period?: PurchasePeriodValue;
  customDate?: number;
  rangeStartDate?: number;
  rangeEndDate?: number;
  page?: number;
  pageSize?: number;
}

export interface PurchaseStatsQuery {
  storeId?: number;
  period?: PurchasePeriodValue;
  customDate?: number;
  rangeStartDate?: number;
  rangeEndDate?: number;
}

export interface PurchaseProductRecord {
  id: number;
  name: string;
  unit: string;
}

export interface PreparedPurchaseItem {
  productId: number | null;
  productName: string;
  unit: string | null;
  quantity: number;
  unitPrice: number;
  amount: number;
}

export const PURCHASE_ORDER_WITH_ITEMS_INCLUDE = {
  items: {
    orderBy: [{ id: 'asc' as const }],
  },
} satisfies Prisma.PurchaseOrderInclude;

export type PurchaseOrderWithItems = Prisma.PurchaseOrderGetPayload<{
  include: typeof PURCHASE_ORDER_WITH_ITEMS_INCLUDE;
}>;

export type PurchaseOrderItemWithAmounts =
  PurchaseOrderWithItems['items'][number];
export type PurchaseCreateItemInput = CreatePurchaseDto['items'][number];

export interface PurchaseStatsAggregate {
  _count: { id: number };
  _sum: { totalAmount: number | null };
}

export interface PurchasePreviousAggregate {
  _sum: { totalAmount: number | null };
}
