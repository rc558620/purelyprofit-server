import {
  buildPaginationMeta,
  toDecimalNumber,
  toOptionalMediaText,
  toTimestampMs,
} from '../../commerce/commerce.utils';
import type {
  InventoryAdjustmentResponseDto,
  InventoryProductResponseDto,
  InventoryReportResponseDto,
  InventoryStatsResponseDto,
  PaginatedInventoryAdjustmentsResponseDto,
  ProductThresholdResponseDto,
} from './dto/inventory.dto';
import {
  buildEmptyInventoryStatsResponse,
  resolveInventoryAlertLevel,
} from './inventory.domain';
import type {
  InventoryAdjustmentRecord,
  InventoryProductRecord,
  InventoryThresholdUpdateRecord,
} from './inventory.types';

export function buildInventoryProductResponse(
  product: InventoryProductRecord,
): InventoryProductResponseDto {
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
    alertLevel: resolveInventoryAlertLevel(
      product.stock,
      product.alertThreshold,
    ),
    ...(image ? { image } : {}),
    createdAt: toTimestampMs(product.createdAt),
    updatedAt: toTimestampMs(product.updatedAt),
  };
}

export function buildInventoryAdjustmentResponse(
  item: InventoryAdjustmentRecord,
): InventoryAdjustmentResponseDto {
  return {
    id: String(item.id),
    productId: String(item.productId),
    productName: item.productName,
    beforeStock: item.beforeStock,
    afterStock: item.afterStock,
    delta: item.delta,
    adjustType: item.adjustType,
    ...(item.note ? { note: item.note } : {}),
    ...(item.purchaseOrderId
      ? { purchaseOrderId: String(item.purchaseOrderId) }
      : {}),
    createdAt: toTimestampMs(item.createdAt),
  };
}

export function buildProductThresholdResponse(
  record: InventoryThresholdUpdateRecord,
): ProductThresholdResponseDto {
  return {
    productId: String(record.id),
    alertThreshold: record.alertThreshold,
    updatedAt: toTimestampMs(record.updatedAt),
  };
}

export function buildEmptyInventoryReportResponse(): InventoryReportResponseDto {
  return {
    summary: buildEmptyInventoryStatsResponse(),
    products: [],
  };
}

export function buildInventoryReportResponse(
  summary: InventoryStatsResponseDto,
  products: InventoryProductResponseDto[],
): InventoryReportResponseDto {
  return {
    summary,
    products,
  };
}

export function buildPaginatedInventoryAdjustmentsResponse(params: {
  items: InventoryAdjustmentRecord[];
  total: number;
  page: number;
  pageSize: number;
}): PaginatedInventoryAdjustmentsResponseDto {
  return {
    items: params.items.map(buildInventoryAdjustmentResponse),
    meta: buildPaginationMeta(params.total, params.page, params.pageSize),
  };
}
