import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { toNullableText } from '../commerce/commerce.utils';
import type {
  MarketingProductCategoriesResponseDto,
  MarketingProductCategoryDto,
} from './dto/marketing-product.response.dto';
import type {
  CreateMarketingProductCategoryDto,
  UpdateMarketingProductCategoryDto,
} from './dto/marketing-product-category.dto';
import { mapProductCategoryRow } from './marketing.mapper';
import { MarketingSharedService } from './marketing-shared.service';

@Injectable()
export class MarketingProductCategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly marketingSharedService: MarketingSharedService,
  ) {}

  async listCategories(
    user: AuthenticatedUser,
    storeId?: number,
  ): Promise<MarketingProductCategoriesResponseDto> {
    const resolvedStoreId =
      await this.marketingSharedService.resolveMembershipManagedStoreId(
        user,
        storeId,
      );
    if (!resolvedStoreId) {
      return { items: [] };
    }

    const rows = await this.prisma.marketingProductCategory.findMany({
      where: { storeId: resolvedStoreId },
      select: {
        id: true,
        name: true,
        icon: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    });

    return {
      items: rows.map(mapProductCategoryRow),
    };
  }

  async createCategory(
    user: AuthenticatedUser,
    storeId: number,
    dto: CreateMarketingProductCategoryDto,
  ): Promise<MarketingProductCategoryDto> {
    await this.marketingSharedService.ensureMarketingStoreAccess(
      user,
      storeId,
      'marketing:manage',
    );

    const normalizedName = dto.name.trim();
    await this.ensureUniqueCategoryName(storeId, normalizedName);

    const created = await this.prisma.marketingProductCategory.create({
      data: {
        storeId,
        name: normalizedName,
        icon: toNullableText(dto.icon) ?? null,
      },
    });

    return mapProductCategoryRow(created);
  }

  async updateCategory(
    user: AuthenticatedUser,
    categoryId: number,
    dto: UpdateMarketingProductCategoryDto,
  ): Promise<MarketingProductCategoryDto> {
    const category =
      await this.marketingSharedService.findProductCategoryOrThrow(categoryId);
    await this.marketingSharedService.ensureMarketingStoreAccess(
      user,
      category.storeId,
      'marketing:manage',
    );

    const nextName = dto.name?.trim();
    if (nextName !== undefined && nextName !== category.name) {
      await this.ensureUniqueCategoryName(
        category.storeId,
        nextName,
        categoryId,
      );
    }

    const updated = await this.prisma.marketingProductCategory.update({
      where: { id: categoryId },
      data: {
        ...(nextName !== undefined ? { name: nextName } : {}),
        ...(dto.icon !== undefined ? { icon: toNullableText(dto.icon) } : {}),
      },
    });

    return mapProductCategoryRow(updated);
  }

  async deleteCategory(
    user: AuthenticatedUser,
    categoryId: number,
  ): Promise<void> {
    const category =
      await this.marketingSharedService.findProductCategoryOrThrow(categoryId);
    await this.marketingSharedService.ensureMarketingStoreAccess(
      user,
      category.storeId,
      'marketing:manage',
    );

    const referencedProductCount = await this.prisma.marketingProduct.count({
      where: { categoryId },
    });
    if (referencedProductCount > 0) {
      throw new BadRequestException('该分类下已有产品，无法删除');
    }

    await this.prisma.marketingProductCategory.delete({
      where: { id: categoryId },
    });
  }

  private async ensureUniqueCategoryName(
    storeId: number,
    name: string,
    excludeCategoryId?: number,
  ): Promise<void> {
    const existing = await this.prisma.marketingProductCategory.findUnique({
      where: { storeId_name: { storeId, name } },
      select: { id: true },
    });
    if (existing && existing.id !== excludeCategoryId) {
      throw new ConflictException('已存在同名分类，请换个名称');
    }
  }
}
