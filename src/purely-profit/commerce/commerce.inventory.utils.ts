/**
 * 库存 / 商品的枚举取值与排序口径。
 *
 * 这些常量同时被 DTO 校验（`@IsIn`）与 service 排序分支使用，
 * 必须保持「字面量数组 + satisfies 类型约束」的双向绑定，
 * 避免 DTO 放宽后与真实查询能力脱节。
 */
import type { InventoryAdjustType } from '@prisma/client';

export const INVENTORY_ADJUST_TYPE_VALUES = [
  'restock',
  'damage',
  'manual',
  'sale',
] as const satisfies readonly InventoryAdjustType[];

export type InventoryManualAdjustTypeValue = 'restock' | 'damage' | 'manual';

/**
 * 人工调整（盘点 / 进货 / 报损）接口允许写入的调整类型。
 *
 * `sale` 与 `custody_*` 只能由业务主链路写入：销售、进货、客存冻结都按 adjustType
 * 聚合流水与报表，一旦人工接口能写入 `sale`，就会被算进销售口径，
 * 且报表侧无法区分真实出库与手工改数。
 */
export const INVENTORY_MANUAL_ADJUST_TYPE_VALUES = [
  'restock',
  'damage',
  'manual',
] as const satisfies readonly InventoryAdjustType[];

export type InventoryStockAlertLevelValue = 'normal' | 'warning' | 'danger';

export const INVENTORY_STOCK_ALERT_LEVEL_VALUES = [
  'normal',
  'warning',
  'danger',
] as const satisfies readonly InventoryStockAlertLevelValue[];

export type InventoryStockSortValue =
  | 'name'
  | 'stock_asc'
  | 'stock_desc'
  | 'alert';

export const INVENTORY_STOCK_SORT_VALUES = [
  'name',
  'stock_asc',
  'stock_desc',
  'alert',
] as const satisfies readonly InventoryStockSortValue[];

export type InventoryAdjustModeValue = 'delta' | 'set';

export const INVENTORY_ADJUST_MODE_VALUES = [
  'delta',
  'set',
] as const satisfies readonly InventoryAdjustModeValue[];

/**
 * 人工库存调整允许的数量上限。
 *
 * 库存列在数据库里是 32 位 Int，越界入参只会在写库时抛底层校验错误；
 * DTO 与业务层统一用这个上限拦截「目标库存 / 增减量 / 调整后库存」，
 * 让非法数量在入参阶段就得到明确的 400。
 */
export const INVENTORY_STOCK_LIMIT = 1_000_000_000;

export type ProductSortValue =
  | 'createdAt'
  | 'name'
  | 'price_asc'
  | 'price_desc'
  | 'profit_desc';

export const PRODUCT_SORT_VALUES = [
  'createdAt',
  'name',
  'price_asc',
  'price_desc',
  'profit_desc',
] as const satisfies readonly ProductSortValue[];
