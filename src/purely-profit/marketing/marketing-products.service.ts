import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { Money } from '../../shared/money.utils';
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
import { resolveMarketingPagination } from './marketing.utils';

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
      return { items: [], total: 0, page: 1, pageSize: 20 };
    }

    const { page, skip, take } = resolveMarketingPagination(
      query.page,
      query.pageSize,
    );

    const [rows, total] = await Promise.all([
      this.prisma.marketingProduct.findMany({
        where: buildMarketingProductWhere({
          storeId: resolvedStoreId,
          categoryId: query.categoryId ?? undefined,
        }),
        include: MARKETING_PRODUCT_ROW_INCLUDE,
        orderBy: resolveMarketingProductOrderBy(query.sortBy),
        take,
        skip,
      }),
      this.prisma.marketingProduct.count({
        where: buildMarketingProductWhere({
          storeId: resolvedStoreId,
          categoryId: query.categoryId ?? undefined,
        }),
      }),
    ]);

    return {
      items: rows.map((row) => mapProductRow(this.toProductRow(row))),
      total,
      page,
      pageSize: take,
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
    try {
      const created = await this.prisma.marketingProduct.create({
        data: {
          storeId,
          categoryId: dto.categoryId,
          name: dto.name.trim(),
          price: Money.fromInputYuan(dto.price).toDbCents(),
          originalPrice:
            dto.originalPrice != null
              ? Money.fromInputYuan(dto.originalPrice).toDbCents()
              : null,
          image: toNullableMediaText(dto.image) ?? null,
          descriptionTitle: toNullableText(dto.descriptionTitle) ?? null,
          description: toNullableText(dto.description) ?? null,
          stock: dto.stock ?? 0,
          durationMinutes: dto.durationMinutes ?? null,
          personCount: dto.personCount ?? null,
        },
        include: MARKETING_PRODUCT_ROW_INCLUDE,
      });

      return mapProductRow(this.toProductRow(created));
    } catch (error: any) {
      // B-9 fix: FK 违例时返回友好 400 而非 500
      if (error?.code === 'P2003') {
        throw new BadRequestException('产品分类不存在或不属于当前门店');
      }
      throw error;
    }
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

    if (dto.categoryId != null) {
      await this.ensureCategoryBelongsToStore(product.storeId, dto.categoryId);
    }

    // 构建更新数据，分离 undefined（不更新）与 null（清空）
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
    if (dto.image !== undefined) data.image = toNullableMediaText(dto.image);
    if (dto.descriptionTitle !== undefined)
      data.descriptionTitle = toNullableText(dto.descriptionTitle);
    if (dto.description !== undefined)
      data.description = toNullableText(dto.description);
    if (dto.stock != null) data.stock = dto.stock;
    if (dto.durationMinutes !== undefined)
      data.durationMinutes = dto.durationMinutes ?? null;
    if (dto.personCount !== undefined)
      data.personCount = dto.personCount ?? null;

    const updated = await this.prisma.marketingProduct.update({
      where: { id: productId },
      data,
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
      categoryName: row.category?.name ?? '',
      name: row.name,
      price: row.price,
      originalPrice: row.originalPrice,
      image: row.image,
      descriptionTitle: row.descriptionTitle,
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
