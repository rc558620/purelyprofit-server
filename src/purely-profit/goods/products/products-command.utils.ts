import { BadRequestException } from '@nestjs/common';
import {
  toNullableMediaText,
  toOptionalText,
} from '../../commerce/commerce.utils';
import { Money } from '../../../shared/money.utils';
import type {
  CreateProductDto,
  ListProductsQueryDto,
  UpdateProductDto,
} from './dto/product.dto';
import type {
  ProductCreateInput,
  ProductListQueryInput,
  ProductUpdateInput,
} from './products.types';

export const toProductListQueryInput = (
  query: ListProductsQueryDto,
): ProductListQueryInput => ({
  storeId: query.storeId,
  page: query.page,
  pageSize: query.pageSize,
  keyword: query.keyword,
  category: query.category,
  categoryId: query.categoryId,
  isActive: query.isActive,
  sortBy: query.sortBy,
});

export const buildCreateProductData = (
  dto: CreateProductDto,
  storeId: number,
  categoryId: number | null,
  code: string,
  profit: Money,
): ProductCreateInput => ({
  storeId,
  categoryId,
  category: dto.category.trim(),
  code,
  name: dto.name.trim(),
  price: Money.fromInputYuan(dto.price).toDbCents(),
  profit: profit.toDbCents(),
  costPrice:
    dto.costPrice !== undefined && dto.costPrice !== null
      ? Money.fromInputYuan(dto.costPrice).toDbCents()
      : null,
  unit: dto.unit.trim(),
  stock: dto.stock ?? 0,
  alertThreshold: dto.alertThreshold ?? 10,
  image: toNullableMediaText(dto.image) ?? null,
  description: toOptionalText(dto.description) ?? null,
});

export const buildUpdateProductData = (
  dto: UpdateProductDto,
  code?: string,
  category?: { category: string; categoryId: number },
  profit?: Money,
): ProductUpdateInput => ({
  ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
  ...(category
    ? { category: category.category, categoryId: category.categoryId }
    : {}),
  ...(code ? { code } : {}),
  ...(dto.price !== undefined
    ? { price: Money.fromInputYuan(dto.price).toDbCents() }
    : {}),
  ...(profit !== undefined ? { profit: profit.toDbCents() } : {}),
  ...(dto.costPrice !== undefined
    ? {
        costPrice:
          dto.costPrice !== null
            ? Money.fromInputYuan(dto.costPrice).toDbCents()
            : null,
      }
    : {}),
  ...(dto.unit !== undefined ? { unit: dto.unit.trim() } : {}),
  ...(dto.stock !== undefined ? { stock: dto.stock } : {}),
  ...(dto.alertThreshold !== undefined
    ? { alertThreshold: dto.alertThreshold }
    : {}),
  ...(dto.image !== undefined
    ? { image: toNullableMediaText(dto.image) ?? null }
    : {}),
  ...(dto.description !== undefined
    ? { description: toOptionalText(dto.description) ?? null }
    : {}),
  ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
});

export const validateProductMoney = (
  price: Money,
  costPrice?: Money | null,
): void => {
  if (!price.isPositive()) throw new BadRequestException('售价必须大于 0');
  if (costPrice !== undefined && costPrice !== null && costPrice.isNegative())
    throw new BadRequestException('成本价不能为负数');
};
