import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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
  InventoryProductRecord,
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

    return this.listProductsByStoreId(storeId, query);
  }

  /**
   * 已通过门店权限校验后的内部查询方法，供 getReport 等场景复用，
   * 避免重复执行 resolveViewStoreId 带来的冗余校验和不一致风险。
   */
  private async listProductsByStoreId(
    storeId: number,
    query: InventoryProductListQueryInput,
  ): Promise<InventoryProductResponseDto[]> {
    const products = await queryInventoryProducts(this.prisma, storeId, query);

    const filteredAndSorted = sortInventoryProducts(
      products.filter((product) => matchesInventoryFilters(product, query)),
      query.sortBy,
    );

    /* BUG-7: 支持分页——不传 page/pageSize 时返回全量（向后兼容） */
    const paginated = this.applyProductPagination(filteredAndSorted, query);

    return paginated.map(buildInventoryProductResponse);
  }

  /**
   * BUG-7: 对已排序的商品列表应用分页截断。
   * 当 page 和 pageSize 都传了时才截断，否则返回全量。
   */
  private applyProductPagination(
    products: InventoryProductRecord[],
    query: InventoryProductListQueryInput,
  ): InventoryProductRecord[] {
    if (
      query.page === undefined ||
      query.page === null ||
      query.pageSize === undefined ||
      query.pageSize === null
    ) {
      return products;
    }

    const skip = (query.page - 1) * query.pageSize;
    return products.slice(skip, skip + query.pageSize);
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

    const [summary, products] = await Promise.all([
      this.getStatsByStoreId(storeId),
      this.listProductsByStoreId(storeId, query),
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
    const product = await findInventoryProductStore(this.prisma, productId);

    if (!product) {
      throw new NotFoundException('商品不存在');
    }

    /* BUG-4: 已下架商品不允许修改预警阈值 */
    if (!product.isActive) {
      throw new BadRequestException('已下架商品不允许修改预警阈值');
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
