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
import { Money } from '../../../shared/money.utils';
import type {
  CreateProductDto,
  ListProductsQueryDto,
  PaginatedProductsResponseDto,
  ProductResponseDto,
  UpdateProductDto,
} from './dto/product.dto';
import {
  ensureProductCategory,
  ensureUniqueProductCode,
  resolveProductCode,
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
  ProductUpdateInput,
} from './products.types';

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly platformMembershipAccessService: PlatformMembershipAccessService,
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

    await this.platformMembershipAccessService.ensureProductQuotaAvailable(
      storeId,
    );
    this.validateMoneyFields(
      Money.fromInputYuan(dto.price),
      Money.fromInputYuan(dto.profit),
      dto.costPrice !== undefined && dto.costPrice !== null
        ? Money.fromInputYuan(dto.costPrice)
        : null,
    );

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
      this.buildCreateProductData(dto, storeId, category?.id ?? null, code),
    );

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

    this.validateMoneyFields(
      dto.price !== undefined
        ? Money.fromInputYuan(dto.price)
        : Money.fromDbCents(product.price),
      dto.profit !== undefined
        ? Money.fromInputYuan(dto.profit)
        : Money.fromDbCents(product.profit),
      dto.costPrice !== undefined
        ? dto.costPrice !== null
          ? Money.fromInputYuan(dto.costPrice)
          : null
        : product.costPrice !== null
          ? Money.fromDbCents(product.costPrice)
          : null,
    );

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
      this.buildUpdateProductData(dto, resolvedCode, resolvedCategoryUpdate),
    );

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
  }

  private toListQueryInput(query: ListProductsQueryDto): ProductListQueryInput {
    return {
      storeId: query.storeId,
      page: query.page,
      pageSize: query.pageSize,
      keyword: query.keyword,
      category: query.category,
      isActive: query.isActive,
      sortBy: query.sortBy,
    };
  }

  private buildCreateProductData(
    dto: CreateProductDto,
    storeId: number,
    categoryId: number | null,
    code: string,
  ): ProductCreateInput {
    return {
      storeId,
      categoryId,
      category: dto.category.trim(),
      code,
      name: dto.name.trim(),
      price: Money.fromInputYuan(dto.price).toDbCents(),
      profit: Money.fromInputYuan(dto.profit).toDbCents(),
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
      ...(dto.profit !== undefined
        ? { profit: Money.fromInputYuan(dto.profit).toDbCents() }
        : {}),
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

  private validateMoneyFields(
    price: Money,
    profit: Money,
    costPrice?: Money | null,
  ): void {
    if (!price.isPositive()) {
      throw new BadRequestException('售价必须大于 0');
    }

    if (!profit.isPositive()) {
      throw new BadRequestException('每单利润必须大于 0');
    }

    if (costPrice !== undefined && costPrice !== null && costPrice.isNegative()) {
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
