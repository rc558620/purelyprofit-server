import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import {
  buildPaginationMeta,
  resolvePagination,
  toNullableMediaText,
  toOptionalText,
} from '../../commerce/commerce.utils';
import { PlatformMembershipAccessService } from '../../member/platform-membership/platform-membership-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { RedisService } from '../../../redis/redis.service';
import { Money } from '../../../shared/money.utils';
import type {
  CreateProductDto,
  ListProductsQueryDto,
  PaginatedProductsResponseDto,
  ProductResponseDto,
  ScanOrderingStatusResponseDto,
  ProductSpecGroupDto,
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
import type {
  ProductCreateInput,
  ProductListQueryInput,
  ProductRecord,
  ProductUpdateInput,
} from './products.types';

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly platformMembershipAccessService: PlatformMembershipAccessService,
    private readonly redisService: RedisService,
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
      query: this.toListQueryInput(query),
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
      await this.ensureCateringStore(storeId);
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

    this.validateMoneyFields(priceMoney, costPriceMoney);
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
      this.buildCreateProductData(
        dto,
        storeId,
        category?.id ?? null,
        code,
        profitMoney,
      ),
    );

    if (dto.specGroups !== undefined) {
      await this.syncProductSpecifications(storeId, product.id, dto.specGroups);
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
      await this.ensureCateringStore(product.storeId);
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

    this.validateMoneyFields(nextPrice, nextCostPrice);
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
      this.buildUpdateProductData(
        dto,
        resolvedCode,
        resolvedCategoryUpdate,
        nextProfit,
      ),
    );

    if (dto.specGroups !== undefined) {
      await this.syncProductSpecifications(
        product.storeId,
        product.id,
        dto.specGroups,
      );
    }

    // 同步商品信息变更到关联的扫码菜单商品
    await this.syncScanOrderingMenuProduct(product.storeId, product.id, {
      ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
      ...(dto.price !== undefined
        ? { basePrice: Money.fromInputYuan(dto.price).toDbCents() }
        : {}),
      ...(dto.image !== undefined
        ? { imageUrl: toNullableMediaText(dto.image) ?? null }
        : {}),
    });

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
    await this.cleanupScanOrderingMenuProduct(product.storeId, product.id);
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
      await this.enableScanOrdering(product, dto.categoryId);
    } else {
      await this.disableScanOrdering(product.storeId, productId);
    }

    // 失效扫码菜单缓存
    await this.invalidateScanOrderingMenuCache(product.storeId);

    return {
      id: String(productId),
      scanOrderingEnabled: dto.enabled,
    };
  }

  private async enableScanOrdering(
    product: ProductRecord,
    categoryId?: number,
  ): Promise<void> {
    const existing = await this.prisma.scanOrderingMenuProduct.findFirst({
      where: { storeId: product.storeId, productId: product.id },
    });

    if (existing) {
      await this.prisma.scanOrderingMenuProduct.update({
        where: { id: existing.id },
        data: {
          isActive: true,
          deletedAt: null,
          name: product.name,
          basePrice: product.price,
          ...(categoryId ? { categoryId } : {}),
        },
      });
      return;
    }

    if (!categoryId) {
      const defaultCategory =
        await this.prisma.scanOrderingMenuCategory.findFirst({
          where: { storeId: product.storeId, deletedAt: null },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        });

      if (!defaultCategory) {
        const created = await this.prisma.scanOrderingMenuCategory.create({
          data: {
            storeId: product.storeId,
            name: '默认分类',
            sortOrder: 0,
          },
        });
        categoryId = created.id;
      } else {
        categoryId = defaultCategory.id;
      }
    }

    const category = await this.prisma.scanOrderingMenuCategory.findFirst({
      where: { id: categoryId, storeId: product.storeId, deletedAt: null },
    });
    if (!category) {
      throw new BadRequestException('扫码菜单分类不存在');
    }

    await this.prisma.scanOrderingMenuProduct.create({
      data: {
        storeId: product.storeId,
        productId: product.id,
        categoryId,
        name: product.name,
        imageUrl: product.image,
        basePrice: product.price,
        isActive: true,
      },
    });
  }

  private async ensureCateringStore(storeId: number): Promise<void> {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { businessMode: true },
    });

    if (!store || store.businessMode !== 'catering') {
      throw new BadRequestException('仅餐饮门店允许配置商品规格');
    }
  }

  /**
   * 将普通商品的规格同步到扫码菜单商品。
   * 未上架商品会创建隐藏菜单实体，以保存规格；首次上架时直接复用该实体。
   */
  private async syncProductSpecifications(
    storeId: number,
    productId: number,
    specGroups: ProductSpecGroupDto[],
  ): Promise<void> {
    const menuProduct = await this.resolveMenuProductForSpecifications(
      storeId,
      productId,
    );

    await this.prisma.$transaction(async (transaction) => {
      await transaction.scanOrderingSpecOption.deleteMany({
        where: { group: { menuProductId: menuProduct.id } },
      });
      await transaction.scanOrderingSpecGroup.deleteMany({
        where: { menuProductId: menuProduct.id },
      });
      if (specGroups.length === 0) return;

      await transaction.scanOrderingSpecGroup.createMany({
        data: specGroups.map((group) => ({
          menuProductId: menuProduct.id,
          name: group.name.trim(),
          selectionType: group.selectMode === 'multi' ? 'multiple' : 'single',
          minSelections: group.minSelect,
          maxSelections: group.maxSelect ?? group.options.length,
          sortOrder: group.sort,
        })),
      });

      const groups = await transaction.scanOrderingSpecGroup.findMany({
        where: { menuProductId: menuProduct.id },
        orderBy: { sortOrder: 'asc' },
        select: { id: true },
      });
      await transaction.scanOrderingSpecOption.createMany({
        data: specGroups.flatMap((group, index) =>
          group.options.map((option) => ({
            groupId: groups[index].id,
            name: option.name.trim(),
            extraPrice: Money.fromInputYuan(option.priceDelta).toDbCents(),
            sortOrder: index,
            isDefault: option.isDefault,
            isActive: option.isActive,
          })),
        ),
      });
    });
    await this.invalidateScanOrderingMenuCache(storeId);
  }

  private async resolveMenuProductForSpecifications(
    storeId: number,
    productId: number,
  ): Promise<{ id: number }> {
    const existing = await this.prisma.scanOrderingMenuProduct.findFirst({
      where: { storeId, productId, deletedAt: null },
      select: { id: true },
    });
    if (existing) return existing;

    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { name: true, image: true, price: true },
    });
    if (!product) throw new NotFoundException('商品不存在');

    const category = await this.resolveDefaultScanOrderingCategory(storeId);
    return this.prisma.scanOrderingMenuProduct.create({
      data: {
        storeId,
        productId,
        categoryId: category.id,
        name: product.name,
        imageUrl: product.image,
        basePrice: product.price,
        isActive: false,
      },
      select: { id: true },
    });
  }

  private async resolveDefaultScanOrderingCategory(
    storeId: number,
  ): Promise<{ id: number }> {
    const category = await this.prisma.scanOrderingMenuCategory.findFirst({
      where: { storeId, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
    if (category) return category;

    return this.prisma.scanOrderingMenuCategory.create({
      data: { storeId, name: '默认分类', sortOrder: 0 },
      select: { id: true },
    });
  }

  private async disableScanOrdering(
    storeId: number,
    productId: number,
  ): Promise<void> {
    await this.prisma.scanOrderingMenuProduct.updateMany({
      where: { storeId, productId, deletedAt: null },
      data: { isActive: false },
    });
  }

  /**
   * 失效扫码菜单缓存。
   * 在商品扫码状态变更、商品信息更新时调用。
   */
  private async invalidateScanOrderingMenuCache(
    storeId: number,
  ): Promise<void> {
    try {
      await this.redisService.del(`scanordering:menu:${storeId}`);
    } catch {
      // 缓存失效失败不影响主流程
    }
  }

  /**
   * 同步普通商品信息变更到关联的扫码菜单商品。
   * 在商品名称、图片、价格等变更后调用。
   */
  private async syncScanOrderingMenuProduct(
    storeId: number,
    productId: number,
    updates: { name?: string; basePrice?: number; imageUrl?: string | null },
  ): Promise<void> {
    const hasUpdates = Object.keys(updates).length > 0;
    if (!hasUpdates) return;

    try {
      await this.prisma.scanOrderingMenuProduct.updateMany({
        where: { storeId, productId, deletedAt: null },
        data: updates,
      });
      await this.invalidateScanOrderingMenuCache(storeId);
    } catch {
      // 同步失败不影响商品主流程，但应记录日志
    }
  }

  /**
   * 商品删除时清理扫码菜单关联：软删除关联的扫码菜单商品。
   */
  private async cleanupScanOrderingMenuProduct(
    storeId: number,
    productId: number,
  ): Promise<void> {
    try {
      await this.prisma.scanOrderingMenuProduct.updateMany({
        where: { storeId, productId, deletedAt: null },
        data: { isActive: false, deletedAt: new Date() },
      });
      await this.invalidateScanOrderingMenuCache(storeId);
    } catch {
      // 清理失败不影响商品删除主流程
    }
  }

  private toListQueryInput(query: ListProductsQueryDto): ProductListQueryInput {
    return {
      storeId: query.storeId,
      page: query.page,
      pageSize: query.pageSize,
      keyword: query.keyword,
      category: query.category,
      categoryId: query.categoryId,
      isActive: query.isActive,
      sortBy: query.sortBy,
    };
  }

  private buildCreateProductData(
    dto: CreateProductDto,
    storeId: number,
    categoryId: number | null,
    code: string,
    profitMoney: Money,
  ): ProductCreateInput {
    return {
      storeId,
      categoryId,
      category: dto.category.trim(),
      code,
      name: dto.name.trim(),
      price: Money.fromInputYuan(dto.price).toDbCents(),
      profit: profitMoney.toDbCents(), // 服务端重算，忽略 dto.profit
      costPrice:
        dto.costPrice !== undefined && dto.costPrice !== null
          ? Money.fromInputYuan(dto.costPrice).toDbCents()
          : null,
      unit: dto.unit.trim(),
      stock: dto.stock ?? 0,
      alertThreshold: dto.alertThreshold ?? 10,
      image: toNullableMediaText(dto.image) ?? null,
      description: toOptionalText(dto.description) ?? null,
    };
  }

  private buildUpdateProductData(
    dto: UpdateProductDto,
    nextCode?: string,
    categoryUpdate?: { category: string; categoryId: number },
    nextProfit?: Money,
  ): ProductUpdateInput {
    return {
      ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
      ...(categoryUpdate
        ? {
            category: categoryUpdate.category,
            categoryId: categoryUpdate.categoryId,
          }
        : {}),
      ...(nextCode ? { code: nextCode } : {}),
      ...(dto.price !== undefined
        ? { price: Money.fromInputYuan(dto.price).toDbCents() }
        : {}),
      // profit 由服务端重算，忽略 dto.profit
      ...(nextProfit !== undefined ? { profit: nextProfit.toDbCents() } : {}),
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
    };
  }

  private validateMoneyFields(price: Money, costPrice?: Money | null): void {
    if (!price.isPositive()) {
      throw new BadRequestException('售价必须大于 0');
    }

    if (
      costPrice !== undefined &&
      costPrice !== null &&
      costPrice.isNegative()
    ) {
      throw new BadRequestException('成本价不能为负数');
    }
  }

  private resolvePagination(page?: number, pageSize?: number) {
    const defaultPageSize =
      this.configService.get<number>('app.defaultPageSize') ?? 20;
    const maxPageSize =
      this.configService.get<number>('app.maxPageSize') ?? 100;
    return resolvePagination(page, pageSize, defaultPageSize, maxPageSize);
  }
}
