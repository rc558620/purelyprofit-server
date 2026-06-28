import { Money } from '../../../shared/money.utils';
import type { InventoryStatsResponseDto } from './dto/inventory.dto';
import type {
  InventoryProductListQueryInput,
  InventoryProductRecord,
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

export function matchesInventoryFilters(
  product: InventoryProductRecord,
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

export function sortInventoryProducts(
  products: InventoryProductRecord[],
  sortBy: InventoryProductListQueryInput['sortBy'] = 'alert',
): InventoryProductRecord[] {
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
  let totalStockValue = 0;

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

    totalStockValue +=
      product.stock *
      (product.costPrice === null ? 0 : Money.fromDbCents(product.costPrice).toOutputYuan());
  }

  return {
    totalSkuCount: products.length,
    warningCount,
    dangerCount,
    normalCount,
    totalStockValue: Number(totalStockValue.toFixed(2)),
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
