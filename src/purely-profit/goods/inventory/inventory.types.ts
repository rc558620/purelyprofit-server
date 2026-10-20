import type { InventoryAdjustType } from '@prisma/client';
import type {
  InventoryManualAdjustTypeValue,
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
  page?: number;
  pageSize?: number;
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
  /** 人工调整接口仅接受进货 / 报损 / 盘点三类，其余类型由业务主链路写入 */
  adjustType: InventoryManualAdjustTypeValue;
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
  price: number;
  profit: number;
  costPrice: number | null;
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
  costPrice: number | null;
}

/** 库存报表 / CSV 导出的最小行：只含报表真正展示的列 */
export interface InventoryReportRow {
  name: string;
  category: string;
  stock: number;
  alertThreshold: number;
}

/**
 * 库存概况的库内聚合结果（单行）。
 *
 * 与 InventoryStatsRow 是同一口径的两种取数方式：
 * 报表场景还要返回明细行，走 InventoryStatsRow；概况卡片不需要明细，走本聚合。
 */
export interface InventoryStatsAggregate {
  totalSkuCount: number;
  dangerCount: number;
  warningCount: number;
  normalCount: number;
  /** 库存总成本（单位：分），与 buildInventoryStats 的整数分口径一致 */
  totalStockValueCents: number;
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
  isActive: boolean;
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

export interface InventoryRevertPurchaseParams {
  storeId: number;
  purchaseOrderId: number;
}

/** 回滚日志查询结构：仅需要商品与当时的 delta（销售/采购回滚共用） */
export interface InventoryRevertLogRecord {
  productId: number;
  delta: number;
}

export interface InventoryAdjustmentPageResult {
  items: InventoryAdjustmentRecord[];
  total: number;
}

export interface InventoryProductPageResult {
  items: InventoryProductRecord[];
  total?: number;
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
  adjustType: InventoryAdjustType;
  note?: string;
  purchaseOrderId?: number;
  saleOrderId?: number;
}

import type { Prisma } from '@prisma/client';

export type InventoryTransactionClient = Prisma.TransactionClient;
