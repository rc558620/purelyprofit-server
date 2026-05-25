import type { InventoryAdjustType, Prisma } from '@prisma/client';
import type {
  InventoryStockAlertLevelValue,
  InventoryStockSortValue,
} from '../../commerce/commerce.utils';

export interface InventoryProductListQueryInput {
  storeId?: number;
  keyword?: string;
  category?: string;
  alertOnly?: boolean;
  alertLevel?: InventoryStockAlertLevelValue;
  sortBy?: InventoryStockSortValue;
}

export interface InventoryReportQueryInput extends InventoryProductListQueryInput {
  export?: boolean;
}

export interface InventoryAdjustmentsListQueryInput {
  storeId?: number;
  productId?: number;
  keyword?: string;
  adjustType?: InventoryAdjustType;
  page?: number;
  pageSize?: number;
}

export interface AdjustInventoryInput {
  storeId?: number;
  productId: number;
  delta?: number;
  targetStock?: number;
  mode?: 'delta' | 'set';
  adjustType: InventoryAdjustType;
  note?: string;
}

export interface UpdateAlertThresholdInput {
  threshold: number;
}

export interface InventoryProductRecord {
  id: number;
  name: string;
  category: string;
  code: string;
  price: { toString(): string } | number;
  profit: { toString(): string } | number;
  costPrice: { toString(): string } | number | null;
  unit: string;
  stock: number;
  alertThreshold: number;
  image: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface InventoryStatsRow {
  stock: number;
  alertThreshold: number;
  costPrice: { toString(): string } | number | null;
}

export interface InventoryAdjustmentRecord {
  id: number;
  productId: number;
  productName: string;
  beforeStock: number;
  afterStock: number;
  delta: number;
  adjustType: InventoryAdjustType;
  note: string | null;
  purchaseOrderId: number | null;
  createdAt: Date;
}

export interface InventoryProductStoreRecord {
  id: number;
  storeId: number;
}

export interface InventoryThresholdUpdateRecord {
  id: number;
  alertThreshold: number;
  updatedAt: Date;
}

export interface InventoryMutableProductRecord {
  id: number;
  name: string;
  stock: number;
}

export interface InventorySaleAdjustmentLogRecord {
  productId: number;
  delta: number;
}

export interface InventoryAdjustedStockParams {
  currentStock: number;
  delta?: number;
  targetStock?: number;
  mode: 'delta' | 'set';
}

export interface InventoryStockChangeItem {
  productId: number;
  quantity: number;
}

export interface InventoryRestockParams {
  storeId: number;
  purchaseOrderId: number;
  operatorStaffId: number | null;
  items: InventoryStockChangeItem[];
}

export interface InventorySaleDeductionParams {
  storeId: number;
  saleOrderId: number;
  operatorStaffId: number | null;
  items: InventoryStockChangeItem[];
}

export interface InventoryRevertSaleParams {
  storeId: number;
  saleOrderId: number;
}

export interface InventoryAdjustmentPageResult {
  items: InventoryAdjustmentRecord[];
  total: number;
}

export interface InventoryAdjustmentLogCreateInput {
  storeId: number;
  productId: number;
  operatorStaffId: number | null;
  productName: string;
  beforeStock: number;
  afterStock: number;
  delta: number;
  adjustType: InventoryAdjustType;
  note?: string | null;
  purchaseOrderId?: number;
  saleOrderId?: number;
}

export interface InventoryStockMutationPlan {
  productId: number;
  afterStock: number;
  log: InventoryAdjustmentLogCreateInput;
}

export interface InventoryRevertStockPlan {
  productId: number;
  stock: number;
}

export interface InventoryManualAdjustmentCommand {
  storeId: number;
  productId: number;
  operatorStaffId: number | null;
  delta?: number;
  targetStock?: number;
  mode: 'delta' | 'set';
  adjustType: InventoryAdjustType;
  note?: string;
}

export interface InventoryStockChangeCommand {
  storeId: number;
  productId: number;
  quantity: number;
  operatorStaffId: number | null;
  adjustType: 'restock' | 'sale';
  note?: string;
  purchaseOrderId?: number;
  saleOrderId?: number;
}

export type InventoryTransactionClient = Prisma.TransactionClient;
