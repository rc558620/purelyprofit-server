import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import {
  buildPaginationMeta,
  resolvePagination,
  toNullableMediaText,
} from '../../commerce/commerce.utils';
import { PlatformMembershipAccessService } from '../../member/platform-membership/platform-membership-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { Money } from '../../../shared/money.utils';
import type {
  CreateProductDto,
  ListProductsQueryDto,
  PaginatedProductsResponseDto,
  ProductResponseDto,
  ScanOrderingStatusResponseDto,
  ToggleScanOrderingStatusDto,
  UpdateProductDto,
} from './dto/product.dto';
import {
  deriveProductProfit,
  ensureProductCategory,
  ensureUniqueProductCode,
  resolveProductCode,
  validateDerivedProfit,
} from './products.domain';
import { buildProductResponse } from './products.mapper';
import {
  createProductRecord,
  deleteProductRecord,
  findProductById,
  findProductStore,
  queryProductPage,
  updateProductRecord,
} from './products.query';
import { ProductsScanOrderingSyncService } from './products-scan-ordering-sync.service';
import {
  buildCreateProductData,
  buildUpdateProductData,
  toProductListQueryInput,
  validateProductMoney,
} from './products-command.utils';

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly platformMembershipAccessService: PlatformMembershipAccessService,
    private readonly scanOrderingSyncService: ProductsScanOrderingSyncService,
  ) {}

  async list(
    user: AuthenticatedUser,
    query: ListProductsQueryDto,
  ): Promise<PaginatedProductsResponseDto> {
    const storeId = await this.commerceAccessService.resolveViewStoreId(
      user,
      query.storeId,
      'goods:view',
      '无权查看该门店商品',
    );
    const { page, skip, take } = this.resolvePagination(
      query.page,
      query.pageSize,
    );

    if (storeId === null) {
      return {
        items: [],
        meta: buildPaginationMeta(0, page, take),
      };
    }

    const result = await queryProductPage(this.prisma, {
      storeId,
      query: toProductListQueryInput(query),
      skip,
      take,
    });

    return {
      items: result.items.map(buildProductResponse),
      meta: buildPaginationMeta(result.total, page, take),
    };
  }

  async detail(
    user: AuthenticatedUser,
    productId: number,
  ): Promise<ProductResponseDto> {
    const product = await findProductById(this.prisma, productId);

    if (!product) {
      throw new NotFoundException('商品不存在');
    }

    await this.commerceAccessService.ensureCanAccessStore(
      user,
      product.storeId,
      'goods:view',
      '无权查看该门店商品',
    );

    return buildProductResponse(product);
  }

  async create(
    user: AuthenticatedUser,
    dto: CreateProductDto,
  ): Promise<ProductResponseDto> {
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      dto.storeId,
      'goods:create',
      '无权操作该门店商品',
    );

    if (dto.specGroups !== undefined) {
      await this.scanOrderingSyncService.ensureCateringStore(storeId);
      this.scanOrderingSyncService.validateSpecificationGroups(dto.specGroups);
    }

    await this.platformMembershipAccessService.ensureProductQuotaAvailable(
      storeId,
    );

    // 服务端重算利润：不再信任 dto.profit，由 price 与 costPrice 推导
    const priceMoney = Money.fromInputYuan(dto.price);
    const costPriceMoney =
      dto.costPrice !== undefined && dto.costPrice !== null
        ? Money.fromInputYuan(dto.costPrice)
        : null;
    const profitMoney = deriveProductProfit(priceMoney, costPriceMoney);

    validateProductMoney(priceMoney, costPriceMoney);
    validateDerivedProfit(profitMoney);

    const categoryName = dto.category.trim();
    const category = await ensureProductCategory(this.prisma, {
      storeId,
      categoryName,
    });
    const code = await resolveProductCode(this.prisma, {
      storeId,
      code: dto.code,
    });

    const product = await createProductRecord(
      this.prisma,
      buildCreateProductData(
        dto,
        storeId,
        category?.id ?? null,
        code,
        profitMoney,
      ),
    );

    if (dto.specGroups !== undefined) {
      await this.scanOrderingSyncService.syncSpecifications(
        storeId,
        product.id,
        dto.specGroups,
      );
      const refreshed = await findProductById(this.prisma, product.id);
      if (refreshed) return buildProductResponse(refreshed);
    }

    return buildProductResponse(product);
  }

  async update(
    user: AuthenticatedUser,
    productId: number,
    dto: UpdateProductDto,
  ): Promise<ProductResponseDto> {
    const product = await findProductById(this.prisma, productId);

    if (!product) {
      throw new NotFoundException('商品不存在');
    }

    await this.commerceAccessService.ensureCanAccessStore(
      user,
      product.storeId,
      'goods:update',
      '无权操作该门店商品',
    );

    if (dto.specGroups !== undefined) {
      await this.scanOrderingSyncService.ensureCateringStore(product.storeId);
      this.scanOrderingSyncService.validateSpecificationGroups(dto.specGroups);
    }

    // 服务端重算利润：合并 dto 与现有记录，推导最终 profit
    const nextPrice =
      dto.price !== undefined
        ? Money.fromInputYuan(dto.price)
        : Money.fromDbCents(product.price);
    const nextCostPrice =
      dto.costPrice !== undefined
        ? dto.costPrice !== null
          ? Money.fromInputYuan(dto.costPrice)
          : null
        : product.costPrice !== null
          ? Money.fromDbCents(product.costPrice)
          : null;
    const nextProfit = deriveProductProfit(nextPrice, nextCostPrice);

    validateProductMoney(nextPrice, nextCostPrice);
    validateDerivedProfit(nextProfit);

    const nextCode = dto.code?.trim();
    if (nextCode && nextCode !== product.code) {
      await ensureUniqueProductCode(this.prisma, {
        storeId: product.storeId,
        code: nextCode,
        excludeId: product.id,
      });
    }
    // DTO 传了 code 字段时，nextCode 有值则写入（含与当前值相同时，用于清理尾部空格等脏数据）
    const resolvedCode = nextCode || undefined;

    const nextCategory = dto.category?.trim();
    const categoryRecord = nextCategory
      ? await ensureProductCategory(this.prisma, {
          storeId: product.storeId,
          categoryName: nextCategory,
        })
      : undefined;

    // 确保 category 与 categoryId 同步：仅当 ensureProductCategory 返回有效分类时才写入
    // 如果 ensureProductCategory 返回 null（理论上对非空字符串不会发生），则跳过分类更新
    const resolvedCategoryUpdate =
      nextCategory && categoryRecord
        ? { category: nextCategory, categoryId: categoryRecord.id }
        : undefined;

    const updated = await updateProductRecord(
      this.prisma,
      product.id,
      buildUpdateProductData(
        dto,
        resolvedCode,
        resolvedCategoryUpdate,
        nextProfit,
      ),
    );

    if (dto.specGroups !== undefined) {
      await this.scanOrderingSyncService.syncSpecifications(
        product.storeId,
        product.id,
        dto.specGroups,
      );
    }

    // 同步商品信息变更到关联的扫码菜单商品
    const menuCategory = nextCategory
      ? await this.scanOrderingSyncService.resolveCategory(
          product.storeId,
          nextCategory,
        )
      : null;
    await this.scanOrderingSyncService.syncProduct(
      product.storeId,
      product.id,
      {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(menuCategory ? { categoryId: menuCategory.id } : {}),
        ...(dto.price !== undefined
          ? { basePrice: Money.fromInputYuan(dto.price).toDbCents() }
          : {}),
        ...(dto.image !== undefined
          ? { imageUrl: toNullableMediaText(dto.image) ?? null }
          : {}),
      },
    );

    if (dto.specGroups !== undefined) {
      const refreshed = await findProductById(this.prisma, product.id);
      if (refreshed) return buildProductResponse(refreshed);
    }

    return buildProductResponse(updated);
  }

  async remove(user: AuthenticatedUser, productId: number): Promise<void> {
    const product = await findProductStore(this.prisma, productId);

    if (!product) {
      throw new NotFoundException('商品不存在');
    }

    await this.commerceAccessService.ensureCanAccessStore(
      user,
      product.storeId,
      'goods:delete',
      '无权删除该门店商品',
    );

    await deleteProductRecord(this.prisma, product.id);

    // 商品删除时清理扫码菜单关联
    await this.scanOrderingSyncService.cleanup(product.storeId, product.id);
  }

  /**
   * 上架/下架到扫码点餐（仅餐饮门店）。
   *
   * enabled=true: 创建或恢复扫码菜单商品关联，同步普通商品基本信息。
   * enabled=false: 仅从扫码菜单下架，不删除普通商品。
   */
  async toggleScanOrderingStatus(
    user: AuthenticatedUser,
    productId: number,
    dto: ToggleScanOrderingStatusDto,
  ): Promise<ScanOrderingStatusResponseDto> {
    const product = await findProductById(this.prisma, productId);
    if (!product) {
      throw new NotFoundException('商品不存在');
    }

    await this.commerceAccessService.ensureCanAccessStore(
      user,
      product.storeId,
      'goods:update',
      '无权操作该门店商品',
    );

    if (dto.enabled) {
      await this.scanOrderingSyncService.enable(product, dto.categoryId);
    } else {
      await this.scanOrderingSyncService.disable(product.storeId, productId);
    }

    // 失效扫码菜单缓存
    await this.scanOrderingSyncService.invalidateCache(product.storeId);

    return {
      id: String(productId),
      scanOrderingEnabled: dto.enabled,
    };
  }

  private resolvePagination(page?: number, pageSize?: number) {
    const defaultPageSize =
      this.configService.get<number>('app.defaultPageSize') ?? 20;
    const maxPageSize =
      this.configService.get<number>('app.maxPageSize') ?? 100;
    return resolvePagination(page, pageSize, defaultPageSize, maxPageSize);
  }
}
