import {
  toDecimalNumber,
  toOptionalMediaText,
  toTimestampMs,
} from '../../commerce/commerce.utils';
import type { ProductResponseDto } from './dto/product.dto';
import type { ProductRecord } from './products.types';

export function buildProductResponse(
  product: ProductRecord,
): ProductResponseDto {
  const image = toOptionalMediaText(product.image);

  return {
    id: String(product.id),
    name: product.name,
    category: product.category,
    code: product.code,
    price: toDecimalNumber(product.price),
    profit: toDecimalNumber(product.profit),
    ...(product.costPrice !== null
      ? { costPrice: toDecimalNumber(product.costPrice) }
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
