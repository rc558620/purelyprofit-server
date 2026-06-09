import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import {
  toNullableMediaText,
  toNullableText,
} from '../commerce/commerce.utils';
import type {
  CreateMarketingProductDto,
  ListMarketingProductsQueryDto,
  MarketingProductDto,
  MarketingProductsResponseDto,
  ToggleMarketingProductDto,
  UpdateMarketingProductDto,
} from './dto/marketing-product.dto';
import {
  buildMarketingProductWhere,
  resolveMarketingProductOrderBy,
} from './marketing.domain';
import { mapProductRow } from './marketing.mapper';
import { MarketingSharedService } from './marketing-shared.service';
import type { MarketingProductRow } from './marketing.types';

const MARKETING_PRODUCT_ROW_INCLUDE = {
  category: {
    select: {
      name: true,
    },
  },
} as const;

type MarketingProductRecord = Prisma.MarketingProductGetPayload<{
  include: typeof MARKETING_PRODUCT_ROW_INCLUDE;
}>;

@Injectable()
export class MarketingProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly marketingSharedService: MarketingSharedService,
  ) {}

  async listProducts(
    user: AuthenticatedUser,
    query: ListMarketingProductsQueryDto,
  ): Promise<MarketingProductsResponseDto> {
    const resolvedStoreId =
      await this.marketingSharedService.resolveMembershipManagedStoreId(
        user,
        query.storeId,
      );
    if (!resolvedStoreId) {
      return { items: [] };
    }

    const rows = await this.prisma.marketingProduct.findMany({
      where: buildMarketingProductWhere({
        storeId: resolvedStoreId,
        categoryId: query.categoryId,
      }),
      include: MARKETING_PRODUCT_ROW_INCLUDE,
      orderBy: resolveMarketingProductOrderBy(query.sortBy),
    });

    return {
      items: rows.map((row) => mapProductRow(this.toProductRow(row))),
    };
  }

  async createProduct(
    user: AuthenticatedUser,
    storeId: number,
    dto: CreateMarketingProductDto,
  ): Promise<MarketingProductDto> {
    await this.marketingSharedService.ensureMarketingStoreAccess(
      user,
      storeId,
      'marketing:manage',
    );
    await this.ensureCategoryBelongsToStore(storeId, dto.categoryId);

    const created = await this.prisma.marketingProduct.create({
      data: {
        storeId,
        categoryId: dto.categoryId,
        name: dto.name.trim(),
        price: dto.price,
        originalPrice: dto.originalPrice ?? null,
        image: toNullableMediaText(dto.image) ?? null,
        description: toNullableText(dto.description) ?? null,
        stock: dto.stock ?? 0,
        durationMinutes: dto.durationMinutes ?? null,
        personCount: dto.personCount ?? null,
      },
      include: MARKETING_PRODUCT_ROW_INCLUDE,
    });

    return mapProductRow(this.toProductRow(created));
  }

  async updateProduct(
    user: AuthenticatedUser,
    productId: number,
    dto: UpdateMarketingProductDto,
  ): Promise<MarketingProductDto> {
    const product =
      await this.marketingSharedService.findProductOrThrow(productId);
    await this.marketingSharedService.ensureMarketingStoreAccess(
      user,
      product.storeId,
      'marketing:manage',
    );

    if (dto.categoryId !== undefined) {
      await this.ensureCategoryBelongsToStore(product.storeId, dto.categoryId);
    }

    const updated = await this.prisma.marketingProduct.update({
      where: { id: productId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId } : {}),
        ...(dto.price !== undefined ? { price: dto.price } : {}),
        ...(dto.originalPrice !== undefined
          ? { originalPrice: dto.originalPrice }
          : {}),
        ...(dto.image !== undefined
          ? { image: toNullableMediaText(dto.image) }
          : {}),
        ...(dto.description !== undefined
          ? { description: toNullableText(dto.description) }
          : {}),
        ...(dto.stock !== undefined ? { stock: dto.stock } : {}),
        ...(dto.durationMinutes !== undefined
          ? { durationMinutes: dto.durationMinutes }
          : {}),
        ...(dto.personCount !== undefined
          ? { personCount: dto.personCount }
          : {}),
      },
      include: MARKETING_PRODUCT_ROW_INCLUDE,
    });

    return mapProductRow(this.toProductRow(updated));
  }

  async deleteProduct(
    user: AuthenticatedUser,
    productId: number,
  ): Promise<void> {
    const product =
      await this.marketingSharedService.findProductOrThrow(productId);
    await this.marketingSharedService.ensureMarketingStoreAccess(
      user,
      product.storeId,
      'marketing:manage',
    );

    await this.prisma.marketingProduct.delete({ where: { id: productId } });
  }

  async toggleProduct(
    user: AuthenticatedUser,
    productId: number,
    dto: ToggleMarketingProductDto,
  ): Promise<MarketingProductDto> {
    const product =
      await this.marketingSharedService.findProductOrThrow(productId);
    await this.marketingSharedService.ensureMarketingStoreAccess(
      user,
      product.storeId,
      'marketing:manage',
    );

    const updated = await this.prisma.marketingProduct.update({
      where: { id: productId },
      data: { isActive: dto.isActive },
      include: MARKETING_PRODUCT_ROW_INCLUDE,
    });

    return mapProductRow(this.toProductRow(updated));
  }

  private async ensureCategoryBelongsToStore(
    storeId: number,
    categoryId: number,
  ): Promise<void> {
    const category =
      await this.marketingSharedService.findProductCategoryOrThrow(categoryId);
    if (category.storeId !== storeId) {
      throw new BadRequestException('产品分类不属于当前门店');
    }
  }

  private toProductRow(
    row: Exclude<MarketingProductRecord, null>,
  ): MarketingProductRow {
    return {
      id: row.id,
      storeId: row.storeId,
      categoryId: row.categoryId,
      categoryName: row.category.name,
      name: row.name,
      price: row.price,
      originalPrice: row.originalPrice,
      image: row.image,
      description: row.description,
      stock: row.stock,
      durationMinutes: row.durationMinutes,
      personCount: row.personCount,
      isActive: row.isActive,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
