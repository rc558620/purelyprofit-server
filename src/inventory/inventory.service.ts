import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type InventoryAdjustType } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../commerce/commerce-access.service';
import {
  buildPaginationMeta,
  resolvePagination,
  toDecimalNumber,
  toOptionalMediaText,
  toTimestampMs,
  type InventoryStockAlertLevelValue,
  type InventoryStockSortValue,
} from '../commerce/commerce.utils';
import { PrismaService } from '../prisma/prisma.service';
import { ProductsService } from '../products/products.service';
import type {
  AdjustInventoryDto,
  InventoryAdjustmentResponseDto,
  InventoryProductResponseDto,
  InventoryReportResponseDto,
  InventoryStatsResponseDto,
  ListInventoryAdjustmentsQueryDto,
  ListInventoryProductsQueryDto,
  PaginatedInventoryAdjustmentsResponseDto,
  ProductThresholdResponseDto,
  UpdateAlertThresholdDto,
} from './dto/inventory.dto';

interface ListInventoryProductsQuery {
  storeId?: number;
  keyword?: string;
  category?: string;
  alertOnly?: boolean;
  alertLevel?: InventoryStockAlertLevelValue;
  sortBy?: InventoryStockSortValue;
}

interface InventoryProductRecord {
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
  createdAt: Date;
  updatedAt: Date;
}

interface InventoryStatsRow {
  stock: number;
  alertThreshold: number;
  costPrice: { toString(): string } | number | null;
}

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly productsService: ProductsService,
  ) {}

  async listProducts(
    user: AuthenticatedUser,
    query: ListInventoryProductsQuery,
  ): Promise<InventoryProductResponseDto[]> {
    const storeId = await this.commerceAccessService.resolveViewStoreId(
      user,
      query.storeId,
      'inventory:view',
      '无权查看该门店库存商品',
    );

    if (storeId === null) {
      return [];
    }

    const products = await this.prisma.product.findMany({
      where: {
        storeId,
        isActive: true,
        ...(query.category ? { category: query.category } : {}),
        ...(query.keyword
          ? {
              OR: [
                {
                  name: {
                    contains: query.keyword,
                    mode: 'insensitive' as const,
                  },
                },
                {
                  code: {
                    contains: query.keyword,
                    mode: 'insensitive' as const,
                  },
                },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        name: true,
        category: true,
        code: true,
        price: true,
        profit: true,
        costPrice: true,
        unit: true,
        stock: true,
        alertThreshold: true,
        image: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return this.sortInventoryProducts(
      products.filter((product) =>
        this.matchesInventoryFilters(product, query),
      ),
      query.sortBy ?? 'alert',
    ).map((product) => this.toInventoryProductResponse(product));
  }

  async removeProduct(
    user: AuthenticatedUser,
    productId: number,
  ): Promise<void> {
    await this.productsService.remove(user, productId);
  }

  async getReport(
    user: AuthenticatedUser,
    query: ListInventoryProductsQueryDto,
  ): Promise<InventoryReportResponseDto> {
    const [summary, products] = await Promise.all([
      this.getStats(user, query.storeId),
      this.listProducts(user, query),
    ]);

    return {
      summary,
      products,
    };
  }

  async listAdjustments(
    user: AuthenticatedUser,
    query: ListInventoryAdjustmentsQueryDto,
  ): Promise<PaginatedInventoryAdjustmentsResponseDto> {
    const storeId = await this.commerceAccessService.resolveViewStoreId(
      user,
      query.storeId,
      'inventory:view',
      '无权查看该门店库存记录',
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
      ...(query.productId ? { productId: query.productId } : {}),
      ...(query.adjustType ? { adjustType: query.adjustType } : {}),
      ...(query.keyword
        ? {
            productName: {
              contains: query.keyword,
              mode: 'insensitive' as const,
            },
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.inventoryAdjustmentLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
      this.prisma.inventoryAdjustmentLog.count({ where }),
    ]);

    return {
      items: items.map((item) => this.toAdjustmentResponse(item)),
      meta: buildPaginationMeta(total, page, take),
    };
  }

  async adjust(
    user: AuthenticatedUser,
    dto: AdjustInventoryDto,
  ): Promise<InventoryAdjustmentResponseDto> {
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      dto.storeId,
      'inventory:update',
      '无权操作该门店库存',
    );
    const operatorStaffId =
      await this.commerceAccessService.findOperatorStaffIdForStore(
        user,
        storeId,
      );

    const effectiveMode =
      dto.mode ?? (dto.targetStock !== undefined ? 'set' : 'delta');

    const result = await this.prisma.$transaction(async (transaction) => {
      const product = await transaction.product.findFirst({
        where: {
          id: dto.productId,
          storeId,
        },
      });

      if (!product) {
        throw new NotFoundException('商品不存在');
      }

      const afterStock = this.resolveAdjustedStock({
        currentStock: product.stock,
        delta: dto.delta,
        targetStock: dto.targetStock,
        mode: effectiveMode,
      });
      const updatedProduct = await transaction.product.update({
        where: { id: product.id },
        data: {
          stock: afterStock,
        },
      });

      const adjustment = await transaction.inventoryAdjustmentLog.create({
        data: {
          storeId,
          productId: product.id,
          operatorStaffId,
          productName: product.name,
          beforeStock: product.stock,
          afterStock,
          delta: afterStock - product.stock,
          adjustType: dto.adjustType,
          note: dto.note?.trim() ? dto.note.trim() : null,
        },
      });

      return {
        updatedProduct,
        adjustment,
      };
    });

    return this.toAdjustmentResponse(result.adjustment);
  }

  async updateAlertThreshold(
    user: AuthenticatedUser,
    productId: number,
    dto: UpdateAlertThresholdDto,
  ): Promise<ProductThresholdResponseDto> {
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
      'inventory:update',
      '无权操作该门店库存',
    );

    const updated = await this.prisma.product.update({
      where: { id: product.id },
      data: {
        alertThreshold: dto.threshold,
      },
      select: {
        id: true,
        alertThreshold: true,
        updatedAt: true,
      },
    });

    return {
      productId: String(updated.id),
      alertThreshold: updated.alertThreshold,
      updatedAt: toTimestampMs(updated.updatedAt),
    };
  }

  async getStats(
    user: AuthenticatedUser,
    storeId?: number,
  ): Promise<InventoryStatsResponseDto> {
    const resolvedStoreId = await this.commerceAccessService.resolveViewStoreId(
      user,
      storeId,
      'inventory:view',
      '无权查看该门店库存数据',
    );

    if (resolvedStoreId === null) {
      return {
        totalSkuCount: 0,
        warningCount: 0,
        dangerCount: 0,
        normalCount: 0,
        totalStockValue: 0,
      };
    }

    const products = await this.prisma.product.findMany({
      where: {
        storeId: resolvedStoreId,
        isActive: true,
      },
      select: {
        stock: true,
        alertThreshold: true,
        costPrice: true,
      },
    });

    let warningCount = 0;
    let dangerCount = 0;
    let normalCount = 0;
    let totalStockValue = 0;

    products.forEach((product: InventoryStatsRow) => {
      const level = this.resolveInventoryAlertLevel(
        product.stock,
        product.alertThreshold,
      );
      if (level === 'danger') {
        dangerCount += 1;
      } else if (level === 'warning') {
        warningCount += 1;
      } else {
        normalCount += 1;
      }

      totalStockValue +=
        product.stock *
        (product.costPrice === null ? 0 : toDecimalNumber(product.costPrice));
    });

    return {
      totalSkuCount: products.length,
      warningCount,
      dangerCount,
      normalCount,
      totalStockValue: Number(totalStockValue.toFixed(2)),
    };
  }

  async recordPurchaseRestock(
    transaction: Prisma.TransactionClient,
    params: {
      storeId: number;
      purchaseOrderId: number;
      operatorStaffId: number | null;
      items: Array<{
        productId: number;
        quantity: number;
      }>;
    },
  ): Promise<void> {
    for (const item of params.items) {
      const product = await transaction.product.findFirst({
        where: {
          id: item.productId,
          storeId: params.storeId,
        },
      });

      if (!product) {
        throw new NotFoundException('商品不存在');
      }

      const afterStock = product.stock + item.quantity;
      await transaction.product.update({
        where: { id: product.id },
        data: {
          stock: afterStock,
        },
      });

      await transaction.inventoryAdjustmentLog.create({
        data: {
          storeId: params.storeId,
          productId: product.id,
          purchaseOrderId: params.purchaseOrderId,
          operatorStaffId: params.operatorStaffId,
          productName: product.name,
          beforeStock: product.stock,
          afterStock,
          delta: item.quantity,
          adjustType: 'restock' satisfies InventoryAdjustType,
        },
      });
    }
  }

  async recordSaleDeduction(
    transaction: Prisma.TransactionClient,
    params: {
      storeId: number;
      saleOrderId: number;
      operatorStaffId: number | null;
      items: Array<{
        productId: number;
        quantity: number;
      }>;
    },
  ): Promise<void> {
    for (const item of params.items) {
      const product = await transaction.product.findFirst({
        where: {
          id: item.productId,
          storeId: params.storeId,
        },
      });

      if (!product) {
        throw new NotFoundException('商品不存在');
      }
      if (product.stock < item.quantity) {
        throw new BadRequestException(`商品【${product.name}】库存不足`);
      }

      const afterStock = product.stock - item.quantity;
      await transaction.product.update({
        where: { id: product.id },
        data: {
          stock: afterStock,
        },
      });

      await transaction.inventoryAdjustmentLog.create({
        data: {
          storeId: params.storeId,
          productId: product.id,
          saleOrderId: params.saleOrderId,
          operatorStaffId: params.operatorStaffId,
          productName: product.name,
          beforeStock: product.stock,
          afterStock,
          delta: -item.quantity,
          adjustType: 'sale' satisfies InventoryAdjustType,
          note: '销售扣减',
        },
      });
    }
  }

  async revertSaleDeduction(
    transaction: Prisma.TransactionClient,
    params: {
      storeId: number;
      saleOrderId: number;
    },
  ): Promise<void> {
    const logs = await transaction.inventoryAdjustmentLog.findMany({
      where: {
        storeId: params.storeId,
        saleOrderId: params.saleOrderId,
        adjustType: 'sale',
      },
      orderBy: [{ id: 'asc' }],
    });

    for (const log of logs) {
      const product = await transaction.product.findFirst({
        where: {
          id: log.productId,
          storeId: params.storeId,
        },
      });

      if (!product) {
        throw new NotFoundException('商品不存在');
      }

      await transaction.product.update({
        where: { id: product.id },
        data: {
          stock: product.stock - log.delta,
        },
      });
    }

    await transaction.inventoryAdjustmentLog.deleteMany({
      where: {
        storeId: params.storeId,
        saleOrderId: params.saleOrderId,
        adjustType: 'sale',
      },
    });
  }

  private resolveAdjustedStock(params: {
    currentStock: number;
    delta?: number;
    targetStock?: number;
    mode: 'delta' | 'set';
  }): number {
    if (params.mode === 'set') {
      if (params.targetStock === undefined) {
        throw new BadRequestException('set 模式下必须传目标库存');
      }
      return params.targetStock;
    }

    return Math.max(0, params.currentStock + (params.delta ?? 0));
  }

  private matchesInventoryFilters(
    product: InventoryProductRecord,
    query: ListInventoryProductsQuery,
  ): boolean {
    const level = this.resolveInventoryAlertLevel(
      product.stock,
      product.alertThreshold,
    );

    if (query.alertLevel) {
      return level === query.alertLevel;
    }

    if (query.alertOnly) {
      return level !== 'normal';
    }

    return true;
  }

  private sortInventoryProducts(
    products: InventoryProductRecord[],
    sortBy: InventoryStockSortValue,
  ): InventoryProductRecord[] {
    const sorted = [...products];

    sorted.sort((left, right) => {
      switch (sortBy) {
        case 'stock_asc':
          return left.stock - right.stock;
        case 'stock_desc':
          return right.stock - left.stock;
        case 'name':
          return left.name.localeCompare(right.name, 'zh-CN');
        case 'alert':
        default: {
          const levelDiff =
            this.getInventoryAlertSortOrder(
              this.resolveInventoryAlertLevel(left.stock, left.alertThreshold),
            ) -
            this.getInventoryAlertSortOrder(
              this.resolveInventoryAlertLevel(
                right.stock,
                right.alertThreshold,
              ),
            );
          return levelDiff !== 0 ? levelDiff : left.stock - right.stock;
        }
      }
    });

    return sorted;
  }

  private getInventoryAlertSortOrder(
    level: InventoryStockAlertLevelValue,
  ): number {
    switch (level) {
      case 'danger':
        return 0;
      case 'warning':
        return 1;
      case 'normal':
      default:
        return 2;
    }
  }

  private resolveInventoryAlertLevel(
    stock: number,
    alertThreshold: number,
  ): InventoryStockAlertLevelValue {
    if (stock <= 0) {
      return 'danger';
    }
    if (stock <= alertThreshold) {
      return 'warning';
    }
    return 'normal';
  }

  private resolvePagination(page?: number, pageSize?: number) {
    const defaultPageSize =
      this.configService.get<number>('app.defaultPageSize') ?? 20;
    const maxPageSize =
      this.configService.get<number>('app.maxPageSize') ?? 100;
    return resolvePagination(page, pageSize, defaultPageSize, maxPageSize);
  }

  private toInventoryProductResponse(
    product: InventoryProductRecord,
  ): InventoryProductResponseDto {
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
      alertLevel: this.resolveInventoryAlertLevel(
        product.stock,
        product.alertThreshold,
      ),
      ...(toOptionalMediaText(product.image)
        ? { image: toOptionalMediaText(product.image) }
        : {}),
      createdAt: toTimestampMs(product.createdAt),
      updatedAt: toTimestampMs(product.updatedAt),
    };
  }

  private toAdjustmentResponse(item: {
    id: number;
    productId: number;
    productName: string;
    beforeStock: number;
    afterStock: number;
    delta: number;
    adjustType: InventoryAdjustType;
    note: string | null;
    purchaseOrderId: number | null;
    createdAt: Date;
  }): InventoryAdjustmentResponseDto {
    return {
      id: String(item.id),
      productId: String(item.productId),
      productName: item.productName,
      beforeStock: item.beforeStock,
      afterStock: item.afterStock,
      delta: item.delta,
      adjustType: item.adjustType,
      ...(item.note ? { note: item.note } : {}),
      ...(item.purchaseOrderId
        ? { purchaseOrderId: String(item.purchaseOrderId) }
        : {}),
      createdAt: toTimestampMs(item.createdAt),
    };
  }
}
