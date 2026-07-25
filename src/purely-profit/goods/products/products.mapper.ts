import {
  toOptionalMediaText,
  toTimestampMs,
} from '../../commerce/commerce.utils';
import { Money } from '../../../shared/money.utils';
import type { ProductResponseDto } from './dto/product.dto';
import type { ProductRecord } from './products.types';
import { deriveProductProfitRate } from './products.domain';

/**
 * 检查普通商品是否已上架到扫码点餐菜单。
 * 存在 isActive=true 且未删除的 ScanOrderingMenuProduct 关联即为已上架。
 */
function hasActiveScanOrderingMenuProduct(product: ProductRecord): boolean {
  if (
    !product.scanOrderingMenuProducts ||
    product.scanOrderingMenuProducts.length === 0
  ) {
    return false;
  }
  return product.scanOrderingMenuProducts.some(
    (item) => item.isActive && item.deletedAt === null,
  );
}

export function buildProductResponse(
  product: ProductRecord,
): ProductResponseDto {
  const image = toOptionalMediaText(product.image);
  const priceMoney = Money.fromDbCents(product.price);
  const profitMoney = Money.fromDbCents(product.profit);

  return {
    id: String(product.id),
    storeId: product.storeId,
    name: product.name,
    category: product.category,
    code: product.code,
    price: priceMoney.toOutputYuan(),
    profit: profitMoney.toOutputYuan(),
    profitRate: deriveProductProfitRate(priceMoney, profitMoney),
    ...(product.costPrice !== null
      ? { costPrice: Money.fromDbCents(product.costPrice).toOutputYuan() }
      : {}),
    unit: product.unit,
    stock: product.stock,
    alertThreshold: product.alertThreshold,
    ...(image ? { image } : {}),
    ...(product.description ? { description: product.description } : {}),
    isActive: product.isActive,
    scanOrderingEnabled: hasActiveScanOrderingMenuProduct(product),
    createdAt: toTimestampMs(product.createdAt),
    updatedAt: toTimestampMs(product.updatedAt),
  };
}
