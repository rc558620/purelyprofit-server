import { BadRequestException, Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  CalculateTimingPriceDto,
  CalculateTimingPriceResponseDto,
  MarketingProductDto,
  MarketingProductsResponseDto,
} from './dto/marketing-product.response.dto';
import type {
  CreateMarketingProductDto,
  UpdateMarketingProductDto,
} from './dto/marketing-product.dto';
import type { ListMarketingProductsQueryDto } from './dto/marketing-product-query.dto';
import type { ToggleMarketingProductDto } from './dto/marketing-product-toggle.dto';
import {
  buildMarketingProductWhere,
  resolveMarketingProductOrderBy,
} from './marketing.domain';
import { mapProductRow } from './marketing.mapper';
import { MarketingSharedService } from './marketing-shared.service';
import {
  assertOriginalPriceNotLessThanPrice,
  calculateTimingPrice,
  resolveCreatedProductBilling,
  resolveUpdatedProductBilling,
} from './marketing-products.billing';
import {
  throwOnProductDeleteError,
  throwOnProductWriteError,
} from './marketing-products.errors';
import {
  MARKETING_PRODUCT_ROW_INCLUDE,
  buildProductCreateData,
  buildProductUpdateData,
  toProductRow,
} from './marketing-products.mapper';
import {
  buildMarketingPaginationMeta,
  resolveMarketingPagination,
} from './marketing.utils';

/**
 * 营销产品：编排层。
 *
 * 鉴权、查询条件、计费规则与写入数据的构建分别收敛在 MarketingSharedService /
 * marketing.domain / marketing-products.billing|mapper|errors，本类只串联流程。
 */
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
    const { page, skip, take } = resolveMarketingPagination(
      query.page,
      query.pageSize,
    );
    const resolvedStoreId =
      await this.marketingSharedService.resolveMembershipManagedStoreId(
        user,
        query.storeId,
      );
    if (!resolvedStoreId) {
      return {
        items: [],
        ...buildMarketingPaginationMeta(0, page, take),
      };
    }

    const where = buildMarketingProductWhere({
      storeId: resolvedStoreId,
      categoryId: query.categoryId ?? undefined,
    });

    const [rows, total] = await Promise.all([
      this.prisma.marketingProduct.findMany({
        where,
        include: MARKETING_PRODUCT_ROW_INCLUDE,
        orderBy: resolveMarketingProductOrderBy(query.sortBy),
        take,
        skip,
      }),
      this.prisma.marketingProduct.count({ where }),
    ]);

    return {
      items: rows.map((row) => mapProductRow(toProductRow(row))),
      ...buildMarketingPaginationMeta(total, page, take),
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

    // B-1 fix: 新增产品时必须校验分类归属当前门店
    await this.ensureCategoryBelongsToStore(storeId, dto.categoryId);

    // B-3 fix: 划线价不得低于售价（校验随计费归一化一起完成）
    assertOriginalPriceNotLessThanPrice(dto.price, dto.originalPrice);
    const billing = resolveCreatedProductBilling(dto);

    try {
      const created = await this.prisma.marketingProduct.create({
        data: buildProductCreateData({ storeId, dto, billing }),
        include: MARKETING_PRODUCT_ROW_INCLUDE,
      });

      return mapProductRow(toProductRow(created));
    } catch (error: unknown) {
      throwOnProductWriteError(error);
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

    const billing = resolveUpdatedProductBilling(product, dto);
    const data = buildProductUpdateData({ dto, billing });

    try {
      const updated = await this.prisma.marketingProduct.update({
        where: { id: productId },
        data,
        include: MARKETING_PRODUCT_ROW_INCLUDE,
      });

      return mapProductRow(toProductRow(updated));
    } catch (error: unknown) {
      throwOnProductWriteError(error);
    }
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

    try {
      await this.prisma.marketingProduct.delete({ where: { id: productId } });
    } catch (error: unknown) {
      throwOnProductDeleteError(error);
    }
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

    return mapProductRow(toProductRow(updated));
  }

  calculateTimingPrice(
    dto: CalculateTimingPriceDto,
  ): CalculateTimingPriceResponseDto {
    return calculateTimingPrice(dto);
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
}
