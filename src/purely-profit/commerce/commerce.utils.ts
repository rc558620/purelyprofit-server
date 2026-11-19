/**
 * commerce 公共工具的统一出口（barrel）。
 *
 * 实现已按职责拆分到同目录下：
 * - `commerce.sales-item.utils.ts`：抵扣 / 券面 / 台位费行识别与净额还原
 * - `commerce.inventory.utils.ts`：库存与商品枚举取值、排序口径
 * - `commerce.normalize.utils.ts`：文本可空 / 可缺省归一
 * - `commerce.pagination.utils.ts`：分页入参归一与元信息拼装
 * - `commerce.period.utils.ts`：统计期次时间范围换算
 *
 * 本文件只做再导出，保持既有 `from '.../commerce/commerce.utils'` 调用点不变；
 * 新增工具请落到对应职责文件，不要继续在本文件堆实现。
 */

// 从 shared 重新导出统一金额值对象与工具函数，保持现有导入路径向后兼容
export {
  Money,
  calcPercentChange,
  calcPercentOfTotal,
  calcPercentPointDiff,
  calcProfitCompare,
  type ProfitCompareResult,
  type ProfitCompareType,
} from '../../shared/money.utils';

export {
  PREPAID_DEDUCTION_PRODUCT_NAME,
  RENEW_DEDUCTION_PRODUCT_NAME,
  SELF_ORDER_DEDUCTION_PRODUCT_ID,
  SELF_ORDER_DEDUCTION_PRODUCT_NAME,
  GROUPON_VOUCHER_ITEM_SUFFIX,
  GROUPON_VOUCHER_CATEGORY_NAME,
  TABLE_FEE_NAME_RE,
  isGrouponVoucherItemName,
  isNonQuantitySalesRecordRow,
  isAmountDeductionSalesRecordRow,
  isDeductionProductName,
  isDeductionItem,
  sumNetPayableCents,
  sumNetProfitCents,
} from './commerce.sales-item.utils';

export {
  INVENTORY_ADJUST_TYPE_VALUES,
  INVENTORY_MANUAL_ADJUST_TYPE_VALUES,
  INVENTORY_STOCK_ALERT_LEVEL_VALUES,
  INVENTORY_STOCK_SORT_VALUES,
  INVENTORY_ADJUST_MODE_VALUES,
  INVENTORY_STOCK_LIMIT,
  PRODUCT_SORT_VALUES,
} from './commerce.inventory.utils';

export type {
  InventoryManualAdjustTypeValue,
  InventoryStockAlertLevelValue,
  InventoryStockSortValue,
  InventoryAdjustModeValue,
  ProductSortValue,
} from './commerce.inventory.utils';

export {
  toTimestampMs,
  toOptionalTimestampMs,
  toOptionalText,
  toOptionalMediaText,
  toNullableText,
  toNullableMediaText,
} from './commerce.normalize.utils';

export {
  buildPaginationMeta,
  resolvePagination,
} from './commerce.pagination.utils';

export type { ResolvedPagination } from './commerce.pagination.utils';

export {
  PURCHASE_PERIOD_VALUES,
  getStartOfDay,
  getEndOfDay,
  getDayStartTimestamp,
  getDayEndTimestamp,
  getWeekStartTimestamp,
  getMonthStartTimestamp,
  getQuarterStartTimestamp,
  buildPreviousRangeByDuration,
  formatMonthDayLabel,
  buildPurchaseDateRange,
  buildPreviousPurchaseDateRange,
} from './commerce.period.utils';

export type { PurchasePeriodValue } from './commerce.period.utils';
