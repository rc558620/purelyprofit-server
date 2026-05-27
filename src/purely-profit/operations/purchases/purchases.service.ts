import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { resolvePagination } from '../../commerce/commerce.utils';
import { PrismaService } from '../../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../../redis/cache-invalidator.service';
import { CostsService } from '../costs/costs.service';
import type {
  CreatePurchaseDto,
  PaginatedPurchasesResponseDto,
  PurchaseResponseDto,
  PurchaseStatsResponseDto,
} from './dto/purchase.dto';
import {
  assertPurchaseSupplierInput,
  buildPurchaseCostTitle,
  buildPurchaseListWhere,
  createPurchaseProductMap,
  extractUniqueProductIds,
  normalizePurchaseNote,
  normalizePurchaseSupplierName,
  preparePurchaseItems,
  resolvePurchaseStatsRanges,
  sumPreparedPurchaseAmount,
} from './purchases.domain';
import {
  buildEmptyPaginatedPurchasesResponse,
  buildEmptyPurchaseStatsResponse,
  buildPaginatedPurchasesResponse,
  buildPurchaseStatsResponse,
  mapPurchaseResponse,
} from './purchases.mapper';
import {
  aggregatePreviousPurchaseOrders,
  aggregatePurchaseOrders,
  countPurchaseOrders,
  countPurchaseSuppliers,
  createPurchaseOrderEntity,
  deletePurchaseOrderEntity,
  findPurchaseOrderAccessRecord,
  findPurchaseSupplier,
  queryPurchaseOrders,
  queryPurchaseProducts,
} from './purchases.query';
import type { PurchaseListQuery, PurchaseStatsQuery } from './purchases.types';

@Injectable()
export class PurchasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheInvalidatorService: CacheInvalidatorService,
    private readonly configService: ConfigService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly costsService: CostsService,
  ) {}

  async list(
    user: AuthenticatedUser,
    query: PurchaseListQuery,
  ): Promise<PaginatedPurchasesResponseDto> {
    const storeId = await this.commerceAccessService.resolveViewStoreId(
      user,
      query.storeId,
      'purchase:view',
      '无权查看该门店进货单',
    );
    const { page, skip, take } = this.resolvePagination(
      query.page,
      query.pageSize,
    );

    if (storeId === null) {
      return buildEmptyPaginatedPurchasesResponse(page, take);
    }

    const where = buildPurchaseListWhere(storeId, query);
    const [orders, total] = await Promise.all([
      queryPurchaseOrders(this.prisma, { where, skip, take }),
      countPurchaseOrders(this.prisma, where),
    ]);

    return buildPaginatedPurchasesResponse(orders, page, take, total);
  }

  async getStats(
    user: AuthenticatedUser,
    query: PurchaseStatsQuery,
  ): Promise<PurchaseStatsResponseDto> {
    const storeId = await this.commerceAccessService.resolveViewStoreId(
      user,
      query.storeId,
      'purchase:view',
      '无权查看该门店进货统计',
    );

    if (storeId === null) {
      return buildEmptyPurchaseStatsResponse();
    }

    const { currentWhere, previousRange } = resolvePurchaseStatsRanges(
      storeId,
      query,
    );
    const [supplierCount, currentAgg, previousAgg] = await Promise.all([
      countPurchaseSuppliers(this.prisma, storeId),
      aggregatePurchaseOrders(this.prisma, currentWhere),
      aggregatePreviousPurchaseOrders(this.prisma, { storeId, previousRange }),
    ]);

    return buildPurchaseStatsResponse({
      supplierCount,
      currentCount: currentAgg._count.id,
      currentTotalAmount: currentAgg._sum.totalAmount,
      previousTotalAmount: previousAgg._sum.totalAmount,
      hasPreviousRange: previousRange !== undefined,
    });
  }

  async create(
    user: AuthenticatedUser,
    dto: CreatePurchaseDto,
  ): Promise<PurchaseResponseDto> {
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      dto.storeId,
      'purchase:create',
      '无权操作该门店进货单',
    );
    const operatorStaffId =
      await this.commerceAccessService.findOperatorStaffIdForStore(
        user,
        storeId,
      );

    const normalizedSupplierName = normalizePurchaseSupplierName(
      dto.supplierName,
    );
    const note = normalizePurchaseNote(dto.note);
    assertPurchaseSupplierInput(dto.supplierId, normalizedSupplierName);

    const supplier = dto.supplierId
      ? await findPurchaseSupplier(this.prisma, {
          storeId,
          supplierId: dto.supplierId,
        })
      : null;

    if (dto.supplierId && !supplier) {
      throw new NotFoundException('供应商不存在');
    }

    const productIds = extractUniqueProductIds(dto.items);
    const productMap = createPurchaseProductMap(
      await queryPurchaseProducts(this.prisma, { storeId, productIds }),
      productIds,
    );
    const preparedItems = preparePurchaseItems(dto.items, productMap);
    const totalAmount = sumPreparedPurchaseAmount(preparedItems);
    const purchaseDate = new Date(dto.date);

    const created = await this.prisma.$transaction(async (transaction) => {
      const order = await createPurchaseOrderEntity(transaction, {
        storeId,
        supplierId: supplier?.id ?? null,
        supplierName: supplier?.name ?? normalizedSupplierName,
        operatorStaffId,
        totalAmount,
        date: purchaseDate,
        note,
        items: preparedItems,
      });

      await this.costsService.syncPurchaseCost(transaction, {
        storeId,
        operatorStaffId,
        purchaseOrderId: order.id,
        amount: totalAmount,
        title: buildPurchaseCostTitle(supplier?.name),
        note,
        date: purchaseDate,
      });

      return order;
    });

    await this.invalidateDashboardCaches(storeId);

    return mapPurchaseResponse(created);
  }

  async remove(user: AuthenticatedUser, purchaseId: number): Promise<void> {
    const purchase = await findPurchaseOrderAccessRecord(
      this.prisma,
      purchaseId,
    );

    if (!purchase) {
      throw new NotFoundException('进货单不存在');
    }

    await this.commerceAccessService.ensureCanAccessStore(
      user,
      purchase.storeId,
      'purchase:delete',
      '无权删除该门店进货单',
    );

    await deletePurchaseOrderEntity(this.prisma, purchase.id);
    await this.invalidateDashboardCaches(purchase.storeId);
  }

  private async invalidateDashboardCaches(storeId: number): Promise<void> {
    await this.cacheInvalidatorService.invalidateProfitDashboardHome(storeId);
  }

  private resolvePagination(page?: number, pageSize?: number) {
    const defaultPageSize =
      this.configService.get<number>('app.defaultPageSize') ?? 20;
    const maxPageSize =
      this.configService.get<number>('app.maxPageSize') ?? 100;
    return resolvePagination(page, pageSize, defaultPageSize, maxPageSize);
  }
}
