import { Injectable } from '@nestjs/common';
import type { ServerResponse } from 'node:http';
import { ConfigService } from '@nestjs/config';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { resolvePagination } from '../../commerce/commerce.utils';
import { PlatformMembershipAccessService } from '../../member/platform-membership/platform-membership-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  InventoryReportResponseDto,
  InventoryStatsResponseDto,
  PaginatedInventoryAdjustmentsResponseDto,
  PaginatedInventoryProductsResponseDto,
} from './dto/inventory.dto';
import {
  buildEmptyInventoryStatsResponse,
  buildInventoryStats,
  buildInventoryStatsFromAggregate,
  matchesInventoryFilters,
  resolveInventoryAlertLevel,
  sortInventoryProducts,
} from './inventory.domain';
import {
  buildEmptyInventoryReportResponse,
  buildInventoryProductResponse,
  buildInventoryReportResponse,
  buildPaginatedInventoryAdjustmentsResponse,
  buildPaginatedInventoryProductsResponse,
} from './inventory.mapper';
import {
  queryInventoryAdjustmentPage,
  queryInventoryAlertProducts,
  queryInventoryProducts,
  queryInventoryReportRows,
  queryInventoryStatsAggregate,
} from './inventory.query';
import type {
  InventoryAdjustmentsListQueryInput,
  InventoryProductListQueryInput,
  InventoryReportQueryInput,
} from './inventory.types';
import { safeStreamCsvExport } from '../../../shared/stream-export.utils';

@Injectable()
export class InventoryReadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly commerceAccessService: CommerceAccessService,
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
   * 报表数据的统一入口校验：门店可见性 + 导出配额。
   *
   * JSON 报表与 CSV 导出共用，避免两条链路各自维护一份权限判断而漂移——
   * 尤其不能让 CSV 绕过 ensureReportExportEnabled（D1 修复过的越权导出）。
   */
  private async resolveReportStoreId(
    user: AuthenticatedUser,
    query: InventoryReportQueryInput,
  ): Promise<number | null> {
    const storeId = await this.commerceAccessService.resolveViewStoreId(
      user,
      query.storeId,
      'inventory:view',
      '无权查看该门店库存报表',
    );

    if (storeId === null) {
      return null;
    }

    const callerIsSubAccount =
      user.currentMembership?.subjectType === 'sub_account';
    if (query.export) {
      await this.platformMembershipAccessService.ensureReportExportEnabled(
        storeId,
        callerIsSubAccount,
      );
    }

    return storeId;
  }

  async getReport(
    user: AuthenticatedUser,
    query: InventoryReportQueryInput,
  ): Promise<InventoryReportResponseDto> {
    const storeId = await this.resolveReportStoreId(user, query);

    if (storeId === null) {
      return buildEmptyInventoryReportResponse();
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
   * 流式导出库存报表 CSV。
   *
   * 不走 getReport：报表接口要返回明细（含价格、图片、时间戳），而 CSV 只用 5 列，
   * 这里改查只含报表列的轻量行，省掉整行传输与内存占用；
   * 筛选与排序复用同一套 domain 口径，保证与 JSON 报表内容一致。
   */
  async streamReportCsv(
    reply: ServerResponse,
    user: AuthenticatedUser,
    query: InventoryReportQueryInput,
  ): Promise<void> {
    const storeId = await this.resolveReportStoreId(user, query);

    const rows =
      storeId === null
        ? []
        : await queryInventoryReportRows(this.prisma, storeId, query);

    const sorted = sortInventoryProducts(
      rows.filter((row) => matchesInventoryFilters(row, query)),
      query.sortBy,
    );

    safeStreamCsvExport(
      reply,
      'inventory-report.csv',
      ['商品名称', '分类', '当前库存', '预警阈值', '库存状态'],
      sorted.map((row) => [
        row.name,
        row.category,
        row.stock,
        row.alertThreshold,
        resolveInventoryAlertLevel(row.stock, row.alertThreshold),
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

    /* 概况只统计不返回明细：交给库内一次聚合，避免把全店 SKU 拉回内存 */
    const aggregate = await queryInventoryStatsAggregate(
      this.prisma,
      resolvedStoreId,
    );
    return buildInventoryStatsFromAggregate(aggregate);
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
       * 域层筛选（alertOnly / alertLevel=warning）涉及 stock <= alert_threshold 的
       * 跨字段比较，Prisma 无法表达，但 raw SQL 可以：直接在库内过滤出预警行，
       * 不再把全店在售商品拉回内存再 filter。
       * 排序仍留在内存（预警级别/库存量/名称的排序规则在 domain 层，下推会复制一份口径）。
       */
      const alertProducts = await queryInventoryAlertProducts(this.prisma, {
        storeId,
        keyword: query.keyword,
        category: query.category,
        // 两者同时传入时，与 matchesInventoryFilters 一致：alertLevel 优先
        mode: query.alertLevel === 'warning' ? 'warning' : 'alertOnly',
      });
      const sorted = sortInventoryProducts(alertProducts, query.sortBy);
      const paginated = sorted.slice(skip, skip + pageSize);

      return buildPaginatedInventoryProductsResponse({
        items: paginated,
        total: sorted.length,
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

  private resolvePagination(page?: number, pageSize?: number) {
    const defaultPageSize =
      this.configService.get<number>('app.defaultPageSize') ?? 20;
    const maxPageSize =
      this.configService.get<number>('app.maxPageSize') ?? 100;
    return resolvePagination(page, pageSize, defaultPageSize, maxPageSize);
  }
}
