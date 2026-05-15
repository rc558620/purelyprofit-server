import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../commerce/commerce-access.service';
import {
  buildPaginationMeta,
  resolvePagination,
  toDecimalNumber,
  toNullableMediaText,
  toOptionalMediaText,
  toOptionalText,
  toTimestampMs,
  type ProductSortValue,
} from '../commerce/commerce.utils';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CreateProductDto,
  ListProductsQueryDto,
  PaginatedProductsResponseDto,
  ProductResponseDto,
  UpdateProductDto,
} from './dto/product.dto';

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly commerceAccessService: CommerceAccessService,
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

    const where = {
      storeId,
      ...(query.category ? { category: query.category } : {}),
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.keyword
        ? {
            OR: [
              {
                name: { contains: query.keyword, mode: 'insensitive' as const },
              },
              {
                code: { contains: query.keyword, mode: 'insensitive' as const },
              },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        orderBy: this.resolveProductOrderBy(query.sortBy),
        skip,
        take,
      }),
      this.prisma.product.count({ where }),
    ]);

    return {
      items: items.map((item) => this.toProductResponse(item)),
      meta: buildPaginationMeta(total, page, take),
    };
  }

  async detail(
    user: AuthenticatedUser,
    productId: number,
  ): Promise<ProductResponseDto> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });

    if (!product) {
      throw new NotFoundException('商品不存在');
    }

    await this.commerceAccessService.ensureCanAccessStore(
      user,
      product.storeId,
      'goods:view',
      '无权查看该门店商品',
    );

    return this.toProductResponse(product);
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

    this.validateMoneyFields(dto.price, dto.profit, dto.costPrice);
    const category = await this.ensureCategory(storeId, dto.category);
    const code = await this.resolveProductCode(storeId, dto.code);

    const product = await this.prisma.product.create({
      data: {
        storeId,
        categoryId: category?.id ?? null,
        category: dto.category.trim(),
        code,
        name: dto.name.trim(),
        price: dto.price,
        profit: dto.profit,
        costPrice: dto.costPrice ?? null,
        unit: dto.unit.trim(),
        stock: dto.stock ?? 0,
        alertThreshold: dto.alertThreshold ?? 10,
        image: toNullableMediaText(dto.image),
        description: toOptionalText(dto.description) ?? null,
      },
    });

    return this.toProductResponse(product);
  }

  async update(
    user: AuthenticatedUser,
    productId: number,
    dto: UpdateProductDto,
  ): Promise<ProductResponseDto> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });

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
      dto.price ?? toDecimalNumber(product.price),
      dto.profit ?? toDecimalNumber(product.profit),
      dto.costPrice ?? toDecimalNumber(product.costPrice),
    );

    const nextCode = dto.code?.trim();
    if (nextCode && nextCode !== product.code) {
      await this.ensureUniqueCode(product.storeId, nextCode, product.id);
    }

    const nextCategory = dto.category?.trim();
    const categoryRecord = nextCategory
      ? await this.ensureCategory(product.storeId, nextCategory)
      : undefined;

    const updated = await this.prisma.product.update({
      where: { id: product.id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(nextCategory
          ? {
              category: nextCategory,
              categoryId: categoryRecord?.id ?? null,
            }
          : {}),
        ...(nextCode ? { code: nextCode } : {}),
        ...(dto.price !== undefined ? { price: dto.price } : {}),
        ...(dto.profit !== undefined ? { profit: dto.profit } : {}),
        ...(dto.costPrice !== undefined ? { costPrice: dto.costPrice } : {}),
        ...(dto.unit !== undefined ? { unit: dto.unit.trim() } : {}),
        ...(dto.stock !== undefined ? { stock: dto.stock } : {}),
        ...(dto.alertThreshold !== undefined
          ? { alertThreshold: dto.alertThreshold }
          : {}),
        ...(dto.image !== undefined
          ? { image: toNullableMediaText(dto.image) }
          : {}),
        ...(dto.description !== undefined
          ? { description: toOptionalText(dto.description) ?? null }
          : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });

    return this.toProductResponse(updated);
  }

  async remove(user: AuthenticatedUser, productId: number): Promise<void> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        storeId: true,
      },
    });

    if (!product) {
      throw new NotFoundException('商品不存在');
    }

    await this.commerceAccessService.ensureCanAccessStore(
      user,
      product.storeId,
      'goods:delete',
      '无权删除该门店商品',
    );

    await this.prisma.product.delete({
      where: { id: product.id },
    });
  }

  private async ensureCategory(
    storeId: number,
    categoryName: string,
  ): Promise<{ id: number } | null> {
    const name = categoryName.trim();
    if (name === '') {
      return null;
    }

    const existing = await this.prisma.productCategory.findFirst({
      where: {
        storeId,
        name,
      },
      select: {
        id: true,
      },
    });

    if (existing) {
      return existing;
    }

    const created = await this.prisma.productCategory.create({
      data: {
        storeId,
        name,
      },
      select: {
        id: true,
      },
    });

    return created;
  }

  private async resolveProductCode(
    storeId: number,
    code: string | undefined,
  ): Promise<string> {
    const normalized = code?.trim();
    if (normalized) {
      await this.ensureUniqueCode(storeId, normalized);
      return normalized;
    }

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const generated = `PRD${Date.now()}${Math.floor(Math.random() * 1000)}`;
      const existing = await this.prisma.product.findFirst({
        where: {
          storeId,
          code: generated,
        },
        select: {
          id: true,
        },
      });
      if (!existing) {
        return generated;
      }
    }

    throw new ConflictException('商品编号生成失败，请重试');
  }

  private async ensureUniqueCode(
    storeId: number,
    code: string,
    excludeId?: number,
  ): Promise<void> {
    const existing = await this.prisma.product.findFirst({
      where: {
        storeId,
        code,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: {
        id: true,
      },
    });

    if (existing) {
      throw new ConflictException('商品编号已存在');
    }
  }

  private validateMoneyFields(
    price: number,
    profit: number,
    costPrice?: number | null,
  ): void {
    if (!Number.isFinite(price) || price <= 0) {
      throw new BadRequestException('售价必须大于 0');
    }

    if (!Number.isFinite(profit) || profit <= 0) {
      throw new BadRequestException('每单利润必须大于 0');
    }

    if (costPrice !== undefined && costPrice !== null && costPrice < 0) {
      throw new BadRequestException('成本价不能为负数');
    }
  }

  private resolveProductOrderBy(sortBy?: ProductSortValue) {
    switch (sortBy) {
      case 'name':
        return [{ name: 'asc' as const }, { id: 'desc' as const }];
      case 'price_asc':
        return [{ price: 'asc' as const }, { id: 'desc' as const }];
      case 'price_desc':
        return [{ price: 'desc' as const }, { id: 'desc' as const }];
      case 'profit_desc':
        return [{ profit: 'desc' as const }, { id: 'desc' as const }];
      case 'createdAt':
      default:
        return [{ createdAt: 'desc' as const }, { id: 'desc' as const }];
    }
  }

  private resolvePagination(page?: number, pageSize?: number) {
    const defaultPageSize =
      this.configService.get<number>('app.defaultPageSize') ?? 20;
    const maxPageSize =
      this.configService.get<number>('app.maxPageSize') ?? 100;
    return resolvePagination(page, pageSize, defaultPageSize, maxPageSize);
  }

  private toProductResponse(product: {
    id: number;
    name: string;
    category: string;
    code: string;
    price: { toString(): string } | number;
    profit: { toString(): string } | number;
    costPrice: { toString(): string } | number | null;
    unit: string;
    stock: number;
    alertThreshold: number;
    image: string | null;
    description: string | null;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): ProductResponseDto {
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
      ...(toOptionalMediaText(product.image)
        ? { image: toOptionalMediaText(product.image) }
        : {}),
      ...(product.description ? { description: product.description } : {}),
      isActive: product.isActive,
      createdAt: toTimestampMs(product.createdAt),
      updatedAt: toTimestampMs(product.updatedAt),
    };
  }
}
