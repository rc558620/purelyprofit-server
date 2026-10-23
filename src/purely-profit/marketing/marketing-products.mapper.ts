// ─── 营销产品「DTO ⇄ 持久层」转换（纯函数，无副作用）──────────────────
//
// - MARKETING_PRODUCT_ROW_INCLUDE / toProductRow：统一「Prisma 行 → 内部
//   MarketingProductRow」口径，列表与 create/update/toggle 的返回值、以及
//   MarketingSharedService.findProductOrThrow 共用同一份映射，避免字段漂移。
// - buildProductCreateData / buildProductUpdateData：DTO → Prisma 写入数据。

import { Prisma } from '@prisma/client';
import { Money } from '../../shared/money.utils';
import {
  toNullableMediaText,
  toNullableText,
} from '../commerce/commerce.utils';
import type {
  CreateMarketingProductDto,
  UpdateMarketingProductDto,
} from './dto/marketing-product.dto';
import type { MarketingProductRow } from './marketing.types';
import type { NormalizedProductBilling } from './marketing-products.billing';

/** 产品行统一 include：带上分类名，标量字段全保留 */
export const MARKETING_PRODUCT_ROW_INCLUDE = {
  category: {
    select: {
      name: true,
    },
  },
} as const;

/** 带分类名的产品记录（findMany / create / update 的返回类型） */
export type MarketingProductRecord = Prisma.MarketingProductGetPayload<{
  include: typeof MARKETING_PRODUCT_ROW_INCLUDE;
}>;

export function toProductRow(
  row: Exclude<MarketingProductRecord, null>,
): MarketingProductRow {
  return {
    id: row.id,
    storeId: row.storeId,
    categoryId: row.categoryId,
    categoryName: row.category?.name ?? '',
    name: row.name,
    price: row.price,
    originalPrice: row.originalPrice,
    costPrice: row.costPrice,
    image: row.image,
    descriptionTitle: row.descriptionTitle,
    description: row.description,
    stock: row.stock,
    durationMinutes: row.durationMinutes,
    personCount: row.personCount,
    unit: row.unit,
    type: row.type,
    validDays: row.validDays,
    billingMode: row.billingMode,
    hourlyRate: row.hourlyRate,
    countdownMinutes: row.countdownMinutes,
    countdownPrice: row.countdownPrice,
    autoCheckout: row.autoCheckout,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** 新增产品：金额由元转分，计费字段统一走归一化结果 */
export function buildProductCreateData(input: {
  storeId: number;
  dto: CreateMarketingProductDto;
  billing: NormalizedProductBilling;
}): Prisma.MarketingProductUncheckedCreateInput {
  const { storeId, dto, billing } = input;

  return {
    storeId,
    categoryId: dto.categoryId,
    name: dto.name.trim(),
    price: Money.fromInputYuan(dto.price).toDbCents(),
    originalPrice:
      dto.originalPrice != null
        ? Money.fromInputYuan(dto.originalPrice).toDbCents()
        : null,
    costPrice:
      dto.costPrice != null
        ? Money.fromInputYuan(dto.costPrice).toDbCents()
        : null,
    image: toNullableMediaText(dto.image) ?? null,
    descriptionTitle: toNullableText(dto.descriptionTitle) ?? null,
    description: toNullableText(dto.description) ?? null,
    stock: dto.stock ?? 0,
    durationMinutes: dto.durationMinutes ?? null,
    personCount: dto.personCount ?? null,
    unit: dto.unit ?? null,
    type: dto.type ?? 'service',
    validDays: billing.validDays,
    billingMode: billing.billingMode,
    hourlyRate: billing.hourlyRateCents,
    countdownMinutes: billing.countdownMinutes,
    countdownPrice: billing.countdownPriceCents,
    autoCheckout: billing.autoCheckout,
  };
}

/** 编辑产品：区分 undefined（不更新）与 null（清空） */
export function buildProductUpdateData(input: {
  dto: UpdateMarketingProductDto;
  billing: NormalizedProductBilling;
}): Prisma.MarketingProductUncheckedUpdateInput {
  const { dto, billing } = input;
  const data: Prisma.MarketingProductUncheckedUpdateInput = {};

  if (dto.name !== undefined) data.name = dto.name.trim();
  if (dto.categoryId != null) data.categoryId = dto.categoryId;
  if (dto.price != null)
    data.price = Money.fromInputYuan(dto.price).toDbCents();
  if (dto.originalPrice !== undefined)
    data.originalPrice =
      dto.originalPrice != null
        ? Money.fromInputYuan(dto.originalPrice).toDbCents()
        : null;
  if (dto.costPrice !== undefined)
    data.costPrice =
      dto.costPrice != null
        ? Money.fromInputYuan(dto.costPrice).toDbCents()
        : null;
  if (dto.image !== undefined) data.image = toNullableMediaText(dto.image);
  if (dto.descriptionTitle !== undefined)
    data.descriptionTitle = toNullableText(dto.descriptionTitle);
  if (dto.description !== undefined)
    data.description = toNullableText(dto.description);
  if (dto.stock != null) data.stock = dto.stock;
  if (dto.durationMinutes !== undefined)
    data.durationMinutes = dto.durationMinutes ?? null;
  if (dto.personCount !== undefined) data.personCount = dto.personCount ?? null;
  if (dto.unit !== undefined) data.unit = dto.unit || null;
  if (dto.type !== undefined) data.type = dto.type;

  // 计费相关字段统一写入归一化结果（含脏数据清理），不再逐个判断 undefined
  data.validDays = billing.validDays;
  data.billingMode = billing.billingMode;
  data.hourlyRate = billing.hourlyRateCents;
  data.countdownMinutes = billing.countdownMinutes;
  data.countdownPrice = billing.countdownPriceCents;
  data.autoCheckout = billing.autoCheckout;

  return data;
}
