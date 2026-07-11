import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ServerResponse } from 'node:http';
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
  InventoryReportResponseDto,
  InventoryStatsResponseDto,
  PaginatedInventoryAdjustmentsResponseDto,
  PaginatedInventoryProductsResponseDto,
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
  buildPaginatedInventoryProductsResponse,
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
import { safeStreamCsvExport } from '../../../shared/stream-export.utils';

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
  ): Promise<PaginatedInventoryProductsResponseDto> {
    const storeId = await this.commerceAccessService.resolveViewStoreId(
      user,
      query.storeId,
      'inventory:view',
      '无权查看该门店库存商品',
    );

    if (storeId === null) {
      /*
       * D3 修复：无权限时仍检查分页参数，确保返回结构的 page/pageSize 与调用方预期一致。
       * 不传分页参数时返回空全量结构（page=1, pageSize=0）。
       */
      if (query.page !== undefined || query.pageSize !== undefined) {
        const { page, take } = this.resolvePagination(
          query.page,
          query.pageSize,
        );
        return buildPaginatedInventoryProductsResponse({
          items: [],
          total: 0,
          page,
          pageSize: take,
        });
      }
      return buildPaginatedInventoryProductsResponse({
        items: [],
        total: 0,
        page: 1,
        pageSize: 0,
      });
    }

    /*
     * D3 修复：不传分页参数时返回全量（保持向后兼容）。
     * D4 优化：传分页参数时，若无域层筛选则下推 skip/take 到 DB 层；
     * 若有域层筛选（alertOnly / alertLevel=warning，Prisma 无法表达跨字段比较），
     * 则回退到内存分页以保证 total 与筛选结果一致。
     */
    const hasPagination =
      query.page !== undefined || query.pageSize !== undefined;
    const hasDomainFilter =
      query.alertOnly === true || query.alertLevel === 'warning';

    if (hasPagination) {
      const { page, skip, take } = this.resolvePagination(
        query.page,
        query.pageSize,
      );
      return this.listProductsByStoreId(
        storeId,
        query,
        page,
        take,
        skip,
        hasDomainFilter,
      );
    }

    return this.listAllProductsByStoreId(storeId, query);
  }

  /**
   * 已通过门店权限校验后的内部查询方法，供 getReport 等场景复用，
   * 避免重复执行 resolveViewStoreId 带来的冗余校验和不一致风险。
   */
  private async listProductsByStoreId(
    storeId: number,
    query: InventoryProductListQueryInput,
    page: number,
    pageSize: number,
    skip: number,
    hasDomainFilter: boolean,
  ): Promise<PaginatedInventoryProductsResponseDto> {
    if (hasDomainFilter) {
      /*
       * 域层筛选（alertOnly / alertLevel=warning）无法下推到 DB，
       * 必须全量加载后内存 filter + slice，确保 total 与筛选结果一致。
       */
      const result = await queryInventoryProducts(this.prisma, storeId, query);
      const filteredAndSorted = sortInventoryProducts(
        result.items.filter((p) => matchesInventoryFilters(p, query)),
        query.sortBy,
      );
      const paginated = filteredAndSorted.slice(skip, skip + pageSize);

      return buildPaginatedInventoryProductsResponse({
        items: paginated,
        total: filteredAndSorted.length,
        page,
        pageSize,
      });
    }

    /*
     * D4 优化：无域层筛选时，分页参数下推到 DB 层，
     * 仅加载当前页数据 + COUNT，而非全量加载后内存切片。
     */
    const result = await queryInventoryProducts(this.prisma, storeId, query, {
      skip,
      take: pageSize,
    });

    return buildPaginatedInventoryProductsResponse({
      items: result.items,
      total: result.total ?? result.items.length,
      page,
      pageSize,
    });
  }

  /**
   * D3 修复：不传分页参数时返回全量结果（保持向后兼容）。
   * 避免 resolvePagination 默认截断为 defaultPageSize 条。
   */
  private async listAllProductsByStoreId(
    storeId: number,
    query: InventoryProductListQueryInput,
  ): Promise<PaginatedInventoryProductsResponseDto> {
    const result = await queryInventoryProducts(this.prisma, storeId, query);

    const filteredAndSorted = sortInventoryProducts(
      result.items.filter((product) => matchesInventoryFilters(product, query)),
      query.sortBy,
    );

    return buildPaginatedInventoryProductsResponse({
      items: filteredAndSorted,
      total: filteredAndSorted.length,
      page: 1,
      pageSize: filteredAndSorted.length,
    });
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

    const callerIsSubAccount =
      user.currentMembership?.subjectType === 'sub_account';
    if (query.export) {
      await this.platformMembershipAccessService.ensureReportExportEnabled(
        storeId,
        callerIsSubAccount,
      );
    }

    /*
     * BUG-2 修复：统计基于筛选后的商品列表计算，保证概况与明细口径一致。
     * BUG-6 修复：不再使用 Number.MAX_SAFE_INTEGER 全量加载，直接复用筛选结果。
     */
    const result = await queryInventoryProducts(this.prisma, storeId, query);
    const filtered = result.items.filter((p) =>
      matchesInventoryFilters(p, query),
    );
    const sorted = sortInventoryProducts(filtered, query.sortBy);
    const summary = buildInventoryStats(sorted);
    const products = sorted.map(buildInventoryProductResponse);

    return buildInventoryReportResponse(summary, products);
  }

  /**
   * 流式导出库存报表 CSV，O(1) 内存占用。
   */
  async streamReportCsv(
    reply: ServerResponse,
    user: AuthenticatedUser,
    query: InventoryReportQueryInput,
  ): Promise<void> {
    const report = await this.getReport(user, query);
    safeStreamCsvExport(
      reply,
      'inventory-report.csv',
      ['商品名称', '分类', '当前库存', '预警阈值', '库存状态'],
      report.products.map((row) => [
        row.name,
        row.category,
        row.stock,
        row.alertThreshold,
        row.alertLevel,
      ]),
    );
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

    if (storeId === null) {
      const { page, take } = this.resolvePagination(query.page, query.pageSize);
      return buildPaginatedInventoryAdjustmentsResponse({
        items: [],
        total: 0,
        page,
        pageSize: take,
      });
    }

    const { page, skip, take } = this.resolvePagination(
      query.page,
      query.pageSize,
    );

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
    const requiredPermission = this.resolveAdjustPermission(dto);
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      dto.storeId,
      requiredPermission,
      '无权操作该门店库存',
    );
    const operatorStaffId =
      await this.commerceAccessService.findOperatorStaffIdForStore(
        user,
        storeId,
      );
    const mode = dto.mode ?? (dto.targetStock !== undefined ? 'set' : 'delta');

    /* BUG-9: delta 和 targetStock 互斥校验 */
    if (dto.delta !== undefined && dto.targetStock !== undefined) {
      throw new BadRequestException('delta 和 targetStock 不能同时传入');
    }

    /* BUG-5 修复：delta 与 targetStock 至少传一个；delta 模式要求 delta≠0 */
    if (mode === 'delta' && (dto.delta === undefined || dto.delta === 0)) {
      throw new BadRequestException(
        '增减模式下必须传非零的 delta，或直接传 targetStock 设置目标库存',
      );
    }

    /* BUG-10: damage 类型强制要求备注 */
    if (dto.adjustType === 'damage' && !dto.note?.trim()) {
      throw new BadRequestException('报损类型必须填写备注说明');
    }

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
    /*
     * BUG-3 修复：
     * 1. findInventoryProductStore 加 deletedAt: null 过滤软删除商品
     * 2. 权限校验前置，避免无权限用户面对已下架商品时拿到业务错误而非权限错误
     */
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

    if (!product.isActive) {
      throw new BadRequestException('已下架商品不允许修改预警阈值');
    }

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

    return this.getStatsByStoreId(resolvedStoreId);
  }

  /**
   * 已通过门店权限校验后的内部统计方法，供 getReport 等场景复用。
   */
  private async getStatsByStoreId(
    storeId: number,
  ): Promise<InventoryStatsResponseDto> {
    const products = await queryInventoryStatsRows(this.prisma, storeId);
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

  private resolveAdjustPermission(
    dto: AdjustInventoryInput,
  ): 'inventory:update' | 'operation-entry:create' {
    const mode = dto.mode ?? (dto.targetStock !== undefined ? 'set' : 'delta');
    const isOperationEntryDeduction =
      dto.adjustType === 'manual' && mode === 'delta' && (dto.delta ?? 0) < 0;

    return isOperationEntryDeduction
      ? 'operation-entry:create'
      : 'inventory:update';
  }
}
