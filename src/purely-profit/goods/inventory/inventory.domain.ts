import { Money } from '../../../shared/money.utils';
import type { InventoryStatsResponseDto } from './dto/inventory.dto';
import type {
  InventoryProductListQueryInput,
  InventoryProductRecord,
  InventoryStatsAggregate,
  InventoryStatsRow,
} from './inventory.types';

export function buildEmptyInventoryStatsResponse(): InventoryStatsResponseDto {
  return {
    totalSkuCount: 0,
    warningCount: 0,
    dangerCount: 0,
    normalCount: 0,
    totalStockValue: 0,
  };
}

export function resolveInventoryAlertLevel(
  stock: number,
  alertThreshold: number,
): 'danger' | 'warning' | 'normal' {
  if (stock <= 0) {
    return 'danger';
  }
  if (stock <= alertThreshold) {
    return 'warning';
  }
  return 'normal';
}

/**
 * 预警筛选只用到 stock 与 alertThreshold：
 * 参数收窄后，CSV 导出的轻量行（只查 4 个字段）也能复用同一口径。
 */
export function matchesInventoryFilters(
  product: Pick<InventoryProductRecord, 'stock' | 'alertThreshold'>,
  query: InventoryProductListQueryInput,
): boolean {
  const level = resolveInventoryAlertLevel(
    product.stock,
    product.alertThreshold,
  );

  if (query.alertLevel) {
    return level === query.alertLevel;
  }

  if (query.alertOnly) {
    return level !== 'normal';
  }

  return true;
}

/** 排序只用到 name / stock / alertThreshold，泛型收窄后轻量行也能复用 */
export function sortInventoryProducts<
  T extends Pick<InventoryProductRecord, 'name' | 'stock' | 'alertThreshold'>,
>(
  products: T[],
  sortBy: InventoryProductListQueryInput['sortBy'] = 'alert',
): T[] {
  const sorted = [...products];

  sorted.sort((left, right) => {
    switch (sortBy) {
      case 'stock_asc':
        return left.stock - right.stock;
      case 'stock_desc':
        return right.stock - left.stock;
      case 'name':
        return left.name.localeCompare(right.name, 'zh-CN');
      case 'alert':
      default: {
        const levelDiff =
          getInventoryAlertSortOrder(
            resolveInventoryAlertLevel(left.stock, left.alertThreshold),
          ) -
          getInventoryAlertSortOrder(
            resolveInventoryAlertLevel(right.stock, right.alertThreshold),
          );
        return levelDiff !== 0 ? levelDiff : left.stock - right.stock;
      }
    }
  });

  return sorted;
}

export function buildInventoryStats(
  products: InventoryStatsRow[],
): InventoryStatsResponseDto {
  let warningCount = 0;
  let dangerCount = 0;
  let normalCount = 0;
  /*
   * BUG-4 修复：在整数"分"维度累加，最后统一转"元"，
   * 避免大量 SKU 浮点累加产生精度误差。
   */
  let totalStockValueCents = 0;

  for (const product of products) {
    const level = resolveInventoryAlertLevel(
      product.stock,
      product.alertThreshold,
    );
    if (level === 'danger') {
      dangerCount += 1;
    } else if (level === 'warning') {
      warningCount += 1;
    } else {
      normalCount += 1;
    }

    if (product.costPrice !== null) {
      totalStockValueCents += product.stock * product.costPrice;
    }
  }

  return {
    totalSkuCount: products.length,
    warningCount,
    dangerCount,
    normalCount,
    totalStockValue: Money.fromDbCents(totalStockValueCents).toOutputYuan(),
  };
}

/**
 * 由库内聚合结果直接构建概况（供 /inventory/stats 使用）。
 *
 * 分级与金额口径在 SQL 侧已算完（见 queryInventoryStatsAggregate），
 * 这里只做单位换算。若调整 buildInventoryStats 的口径，
 * 必须同步 SQL 里的 FILTER 条件，否则概况卡片与报表明细会出现两套数字。
 */
export function buildInventoryStatsFromAggregate(
  aggregate: InventoryStatsAggregate,
): InventoryStatsResponseDto {
  return {
    totalSkuCount: aggregate.totalSkuCount,
    warningCount: aggregate.warningCount,
    dangerCount: aggregate.dangerCount,
    normalCount: aggregate.normalCount,
    totalStockValue: Money.fromDbCents(
      aggregate.totalStockValueCents,
    ).toOutputYuan(),
  };
}

function getInventoryAlertSortOrder(
  level: 'danger' | 'warning' | 'normal',
): number {
  switch (level) {
    case 'danger':
      return 0;
    case 'warning':
      return 1;
    case 'normal':
    default:
      return 2;
  }
}
