import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { resolvePagination } from '../../commerce/commerce.utils';
import { PlatformMembershipAccessService } from '../../member/platform-membership/platform-membership-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { ProductsService } from '../products/products.service';
import type {
  InventoryAdjustmentResponseDto,
  InventoryProductResponseDto,
  InventoryReportResponseDto,
  InventoryStatsResponseDto,
  PaginatedInventoryAdjustmentsResponseDto,
  ProductThresholdResponseDto,
} from './dto/inventory.dto';
import {
  buildEmptyInventoryStatsResponse,
  buildInventoryStats,
  matchesInventoryFilters,
  sortInventoryProducts,
} from './inventory.domain';
import {
  buildEmptyInventoryReportResponse,
  buildInventoryAdjustmentResponse,
  buildInventoryProductResponse,
  buildInventoryReportResponse,
  buildPaginatedInventoryAdjustmentsResponse,
  buildProductThresholdResponse,
} from './inventory.mapper';
import {
  findInventoryProductStore,
  queryInventoryAdjustmentPage,
  queryInventoryProducts,
  queryInventoryStatsRows,
  updateInventoryAlertThresholdRecord,
} from './inventory.query';
import {
  executeInventoryManualAdjustment,
  recordInventoryRestock,
  recordInventorySaleDeduction,
  revertInventorySaleDeduction,
} from './inventory-stock.query';
import type {
  AdjustInventoryInput,
  InventoryAdjustmentsListQueryInput,
  InventoryProductListQueryInput,
  InventoryReportQueryInput,
  InventoryRestockParams,
  InventoryRevertSaleParams,
  InventorySaleDeductionParams,
  UpdateAlertThresholdInput,
} from './inventory.types';

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly productsService: ProductsService,
    private readonly platformMembershipAccessService: PlatformMembershipAccessService,
  ) {}

  async listProducts(
    user: AuthenticatedUser,
    query: InventoryProductListQueryInput,
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

    const products = await queryInventoryProducts(this.prisma, storeId, query);

    return sortInventoryProducts(
      products.filter((product) => matchesInventoryFilters(product, query)),
      query.sortBy,
    ).map(buildInventoryProductResponse);
  }

  async removeProduct(
    user: AuthenticatedUser,
    productId: number,
  ): Promise<void> {
    await this.productsService.remove(user, productId);
  }

  async getReport(
    user: AuthenticatedUser,
    query: InventoryReportQueryInput,
  ): Promise<InventoryReportResponseDto> {
    const storeId = await this.commerceAccessService.resolveViewStoreId(
      user,
      query.storeId,
      'inventory:view',
      '无权查看该门店库存报表',
    );

    if (storeId === null) {
      return buildEmptyInventoryReportResponse();
    }

    if (query.export) {
      await this.platformMembershipAccessService.ensureReportExportEnabled(
        storeId,
      );
    }

    const [summary, products] = await Promise.all([
      this.getStats(user, storeId),
      this.listProducts(user, { ...query, storeId }),
    ]);

    return buildInventoryReportResponse(summary, products);
  }

  async listAdjustments(
    user: AuthenticatedUser,
    query: InventoryAdjustmentsListQueryInput,
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
      return buildPaginatedInventoryAdjustmentsResponse({
        items: [],
        total: 0,
        page,
        pageSize: take,
      });
    }

    const result = await queryInventoryAdjustmentPage(this.prisma, {
      storeId,
      query,
      skip,
      take,
    });

    return buildPaginatedInventoryAdjustmentsResponse({
      ...result,
      page,
      pageSize: take,
    });
  }

  async adjust(
    user: AuthenticatedUser,
    dto: AdjustInventoryInput,
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
    const mode = dto.mode ?? (dto.targetStock !== undefined ? 'set' : 'delta');

    const adjustment = await this.prisma.$transaction((transaction) =>
      executeInventoryManualAdjustment(transaction, {
        storeId,
        productId: dto.productId,
        operatorStaffId,
        delta: dto.delta,
        targetStock: dto.targetStock,
        mode,
        adjustType: dto.adjustType,
        note: dto.note?.trim() ? dto.note.trim() : undefined,
      }),
    );

    return buildInventoryAdjustmentResponse(adjustment);
  }

  async updateAlertThreshold(
    user: AuthenticatedUser,
    productId: number,
    dto: UpdateAlertThresholdInput,
  ): Promise<ProductThresholdResponseDto> {
    const product = await findInventoryProductStore(this.prisma, productId);

    if (!product) {
      throw new NotFoundException('商品不存在');
    }

    await this.commerceAccessService.ensureCanAccessStore(
      user,
      product.storeId,
      'inventory:update',
      '无权操作该门店库存',
    );

    const updated = await updateInventoryAlertThresholdRecord(
      this.prisma,
      product.id,
      dto.threshold,
    );

    return buildProductThresholdResponse(updated);
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
      return buildEmptyInventoryStatsResponse();
    }

    const products = await queryInventoryStatsRows(
      this.prisma,
      resolvedStoreId,
    );
    return buildInventoryStats(products);
  }

  async recordPurchaseRestock(
    transaction: Prisma.TransactionClient,
    params: InventoryRestockParams,
  ): Promise<void> {
    await recordInventoryRestock(transaction, params);
  }

  async recordSaleDeduction(
    transaction: Prisma.TransactionClient,
    params: InventorySaleDeductionParams,
  ): Promise<void> {
    await recordInventorySaleDeduction(transaction, params);
  }

  async revertSaleDeduction(
    transaction: Prisma.TransactionClient,
    params: InventoryRevertSaleParams,
  ): Promise<void> {
    await revertInventorySaleDeduction(transaction, params);
  }

  private resolvePagination(page?: number, pageSize?: number) {
    const defaultPageSize =
      this.configService.get<number>('app.defaultPageSize') ?? 20;
    const maxPageSize =
      this.configService.get<number>('app.maxPageSize') ?? 100;
    return resolvePagination(page, pageSize, defaultPageSize, maxPageSize);
  }
}
