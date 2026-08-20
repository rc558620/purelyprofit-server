// 销售明细行聚合：按「商品 ID + 商品名称 + 规格」叠加同一订单内的相同商品行
import { Money } from '../../../shared/money.utils';
import { isDeductionProductName } from '../../commerce/commerce.utils';
import type {
  SaleOrderWithItems,
  ScanOrderingEnrichment,
} from './sales-record.domain';
import type { SalesRecordAmountsSnapshot } from './sales-record-amounts.domain';

/** 销售明细行：原始商品项 + 与订单 items 原始顺序对齐的规格/原价 */
export interface SalesRecordItemRow {
  item: SaleOrderWithItems['items'][number];
  specs: string[];
  originalUnitPrice?: number;
}

/**
 * 构建可见销售明细行：
 * 1. 扫码订单的规格/原价快照按订单 items 原始索引对齐（存在抵扣行时索引不漂移）；
 * 2. 过滤抵扣行（预付款 + 续费抵扣），销售记录只展示实际消费。
 */
export function buildVisibleSalesRecordRows(
  order: SaleOrderWithItems,
  enrichment?: ScanOrderingEnrichment,
): SalesRecordItemRow[] {
  return order.items
    .map((item, index) => ({
      item,
      specs: enrichment?.specsRows[index] ?? [],
      originalUnitPrice: enrichment?.originalUnitPrices[index],
    }))
    .filter((row) => !isDeductionProductName(row.item.productName));
}

/** 聚合后的销售明细行：数量/小计已叠加，单价为数量加权平均（元） */
export interface AggregatedSalesRecordItem {
  productId: string;
  productName: string;
  categoryName: string;
  salePrice: number;
  profit: number;
  quantity: number;
  subtotal: number;
  specs?: string[];
  originalUnitPrice?: number;
}

/** 聚合分桶：首行 + 累加数量/金额（分） */
interface SalesRecordItemGroup {
  row: SalesRecordItemRow;
  quantity: number;
  subtotal: Money;
  salePriceFenSum: number;
  profitFenSum: number;
  originalUnitPriceFenSum: number;
  hasOriginalUnitPrice: boolean;
}

/** 生成聚合键：商品 ID + 商品名称 + 规格（JSON 序列化避免分隔符歧义） */
function buildSalesRecordItemKey(row: SalesRecordItemRow): string {
  return JSON.stringify([
    row.item.productId ?? 'manual',
    row.item.productName,
    row.specs,
  ]);
}

/** 元金额转分（四舍五入），用于原价加权平均 */
function yuanToFen(yuan: number): number {
  return Math.round(yuan * 100);
}

/**
 * 按「商品 ID + 商品名称 + 规格」合并同一订单内的相同商品行：
 * - 数量 = 各行数量之和；小计 = 各行小计之和（Money 精确累加）
 * - 单价/利润/原价 = 按数量加权平均（分单位计算，避免浮点误差）
 * - 金额合计（totalRevenue/totalProfit/totalQuantity）在聚合前后保持不变
 */
export function aggregateSalesRecordItems(
  rows: SalesRecordItemRow[],
  amounts: SalesRecordAmountsSnapshot['items'],
): AggregatedSalesRecordItem[] {
  const groups = new Map<string, SalesRecordItemGroup>();

  rows.forEach((row, index) => {
    const key = buildSalesRecordItemKey(row);
    const amount = amounts[index];
    const existing = groups.get(key);
    if (existing) {
      existing.quantity += row.item.quantity;
      existing.subtotal = existing.subtotal.add(
        Money.fromInputYuan(amount.subtotal),
      );
      existing.salePriceFenSum +=
        Number(row.item.salePrice) * row.item.quantity;
      existing.profitFenSum += Number(row.item.profit) * row.item.quantity;
      if (row.originalUnitPrice !== undefined) {
        existing.originalUnitPriceFenSum +=
          yuanToFen(row.originalUnitPrice) * row.item.quantity;
      } else {
        existing.hasOriginalUnitPrice = false;
      }
      return;
    }
    groups.set(key, {
      row,
      quantity: row.item.quantity,
      subtotal: Money.fromInputYuan(amount.subtotal),
      salePriceFenSum: Number(row.item.salePrice) * row.item.quantity,
      profitFenSum: Number(row.item.profit) * row.item.quantity,
      originalUnitPriceFenSum:
        row.originalUnitPrice !== undefined
          ? yuanToFen(row.originalUnitPrice) * row.item.quantity
          : 0,
      hasOriginalUnitPrice: row.originalUnitPrice !== undefined,
    });
  });

  return Array.from(groups.values()).map((group) => {
    const { row, quantity } = group;
    return {
      productId:
        row.item.productId !== null
          ? String(row.item.productId)
          : `manual_${row.item.id}`,
      productName: row.item.productName,
      categoryName: row.item.categoryName,
      salePrice: Money.fromDbCents(
        Math.round(group.salePriceFenSum / quantity),
      ).toOutputYuan(),
      profit: Money.fromDbCents(
        Math.round(group.profitFenSum / quantity),
      ).toOutputYuan(),
      quantity,
      subtotal: group.subtotal.toOutputYuan(),
      ...(row.specs.length > 0 ? { specs: row.specs } : {}),
      ...(group.hasOriginalUnitPrice && group.originalUnitPriceFenSum > 0
        ? {
            originalUnitPrice: Money.fromDbCents(
              Math.round(group.originalUnitPriceFenSum / quantity),
            ).toOutputYuan(),
          }
        : {}),
    };
  });
}
