import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { Money } from '../../../shared/money.utils';
import { PlatformMembershipAccessService } from '../../member/platform-membership/platform-membership-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  ListSalesRecordsQueryDto,
  SalesRecordListResponseDto,
  SalesStatsResponseDto,
} from './dto/sales-record.dto';
import {
  buildPaginationMeta,
  resolvePagination,
} from '../../commerce/commerce.utils';
import {
  buildScanOrderingEnrichment,
  mapSalesRecordResponse,
} from './sales-record.domain';
import {
  aggregateOrderStats,
  countSaleOrders,
  querySaleOrders,
  queryScanOrderingDetails,
} from './sales-record.query';
import {
  buildEmptySalesListResponse,
  buildSalesCurrentRange,
} from './sales-record-read.utils';

@Injectable()
export class SalesRecordListService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly platformMembershipAccessService: PlatformMembershipAccessService,
    private readonly configService: ConfigService,
  ) {}

  async list(
    user: AuthenticatedUser,
    query: ListSalesRecordsQueryDto,
  ): Promise<SalesRecordListResponseDto> {
    const storeId = await this.commerceAccessService.resolveViewStoreId(
      user,
      query.storeId,
      'sales:view',
      '无权查看该门店销售记录',
    );

    const { page, skip, take } = this.resolvePagination(
      query.page,
      query.pageSize,
    );

    if (storeId === null) {
      return buildEmptySalesListResponse(page, take);
    }

    const callerIsSubAccount =
      user.currentMembership?.subjectType === 'sub_account';
    const range = await this.platformMembershipAccessService.clampHistoryRange(
      storeId,
      buildSalesCurrentRange(query),
      callerIsSubAccount,
    );
    if (range.empty) {
      return buildEmptySalesListResponse(page, take);
    }

    const orders = await querySaleOrders(this.prisma, {
      storeId,
      range: { start: range.start, end: range.end },
      skip,
      take,
    });
    // 收集扫码点餐订单 ID（仅餐饮账号的扫码订单存在，普通订单为空）
    const scanOrderIds = orders
      .map((order) => order.scanOrderId)
      .filter((id): id is number => id !== null && id !== undefined);
    const [total, currentStats, scanOrderingDetails] = await Promise.all([
      countSaleOrders(this.prisma, {
        storeId,
        range: { start: range.start, end: range.end },
      }),
      aggregateOrderStats(this.prisma, storeId, {
        start: range.start,
        end: range.end,
      }),
      queryScanOrderingDetails(this.prisma, scanOrderIds),
    ]);
    const scanOrderingDetailMap = new Map(
      scanOrderingDetails.map((detail) => [detail.id, detail]),
    );
    const items = orders.map((order) => {
      const scanOrderId = order.scanOrderId;
      if (scanOrderId === null) {
        return mapSalesRecordResponse(order);
      }
      const scan = scanOrderingDetailMap.get(scanOrderId);
      return mapSalesRecordResponse(
        order,
        scan ? buildScanOrderingEnrichment(order, scan) : undefined,
      );
    });

    const summary: SalesStatsResponseDto = {
      totalRevenue: currentStats.totalRevenue,
      totalProfit: currentStats.totalProfit,
      orderCount: currentStats.orderCount,
      avgOrderValue:
        currentStats.orderCount > 0
          ? Money.fromInputYuan(currentStats.totalRevenue)
              .divide(currentStats.orderCount)
              .toOutputYuan()
          : 0,
      compareLastPeriod: null,
    };

    return {
      items,
      meta: buildPaginationMeta(total, page, take),
      summary,
    };
  }

  listFrontendOrders(
    user: AuthenticatedUser,
    query: ListSalesRecordsQueryDto,
  ): Promise<SalesRecordListResponseDto> {
    return this.list(user, {
      ...query,
      period: this.resolveFrontendCompatiblePeriod(query),
    });
  }

  private resolveFrontendCompatiblePeriod(
    query: ListSalesRecordsQueryDto,
  ): ListSalesRecordsQueryDto['period'] {
    if (query.period) {
      return query.period;
    }
    if (
      query.rangeStartDate !== undefined ||
      query.rangeEndDate !== undefined
    ) {
      return 'custom_range';
    }
    if (query.customDate !== undefined) {
      return 'custom_month';
    }
    if (query.year !== undefined) {
      return 'year';
    }

    return 'all';
  }

  private resolvePagination(page?: number, pageSize?: number) {
    const defaultPageSize =
      this.configService.get<number>('app.defaultPageSize') ?? 20;
    const maxPageSize =
      this.configService.get<number>('app.maxPageSize') ?? 100;

    return resolvePagination(page, pageSize, defaultPageSize, maxPageSize);
  }
}
