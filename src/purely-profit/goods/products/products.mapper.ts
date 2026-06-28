import {
  toOptionalMediaText,
  toTimestampMs,
} from '../../commerce/commerce.utils';
import { Money } from '../../../shared/money.utils';
import type { ProductResponseDto } from './dto/product.dto';
import type { ProductRecord } from './products.types';

export function buildProductResponse(
  product: ProductRecord,
): ProductResponseDto {
  const image = toOptionalMediaText(product.image);

  return {
    id: String(product.id),
    storeId: product.storeId,
    name: product.name,
    category: product.category,
    code: product.code,
    price: Money.fromDbCents(product.price).toOutputYuan(),
    profit: Money.fromDbCents(product.profit).toOutputYuan(),
    ...(product.costPrice !== null
      ? { costPrice: Money.fromDbCents(product.costPrice).toOutputYuan() }
      : {}),
    unit: product.unit,
    stock: product.stock,
    alertThreshold: product.alertThreshold,
    ...(image ? { image } : {}),
    ...(product.description ? { description: product.description } : {}),
    isActive: product.isActive,
    createdAt: toTimestampMs(product.createdAt),
    updatedAt: toTimestampMs(product.updatedAt),
  };
}
