import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
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
  buildSpaceSessionSpecsEnrichment,
} from './sales-record-enrichment';
import { mapSalesRecordResponse } from './sales-record.domain';
import {
  countSaleOrders,
  querySaleOrders,
  queryScanOrderingDetails,
  querySpaceSessionSpecDetails,
} from './sales-record.query';
import { SalesRecordStatsService } from './sales-record-stats.service';
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
    private readonly salesRecordStatsService: SalesRecordStatsService,
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

    // 分页数据、「总数」与「汇总」三者互不依赖，提前一并发出，
    // 避免总查询耗时变成各查询串行累加。
    const ordersPromise = querySaleOrders(this.prisma, {
      storeId,
      range: { start: range.start, end: range.end },
      skip,
      take,
    });
    // 总条数的过滤条件与分页查询完全一致，且与 orders 无数据依赖，
    // 一并发出可省掉一次串行往返（大表 COUNT 可达数十毫秒）。
    const totalPromise = countSaleOrders(this.prisma, {
      storeId,
      range: { start: range.start, end: range.end },
    });
    // 汇总（summary）复用 stats 接口的缓存结果：两者的周期解析、clampHistoryRange
    // 与子账号作用域判定完全同源，可共享同一份缓存。常态命中缓存，
    // 不必每次列表请求都对全店范围重做一遍 items/refunds 聚合。
    const statsPromise = this.salesRecordStatsService.getCachedStats(
      storeId,
      query,
      callerIsSubAccount,
    );

    const orders = await ordersPromise;
    // 收集扫码点餐订单 ID（仅餐饮账号的扫码订单存在，普通订单为空）
    const scanOrderIds = orders
      .map((order) => order.scanOrderId)
      .filter((id): id is number => id !== null && id !== undefined);
    // 收集非扫码订单 ID（空间会话结账订单：自助下单 / 追加点单，用于规格展示）
    const nonScanSaleOrderIds = orders
      .filter((order) => order.scanOrderId === null)
      .map((order) => order.id);
    const [total, stats, scanOrderingDetails, spaceSessionSpecs] =
      await Promise.all([
        totalPromise,
        statsPromise,
        queryScanOrderingDetails(this.prisma, scanOrderIds),
        querySpaceSessionSpecDetails(this.prisma, nonScanSaleOrderIds),
      ]);
    const scanOrderingDetailMap = new Map(
      scanOrderingDetails.map((detail) => [detail.id, detail]),
    );
    // key 必须是 SaleOrder.id（会话侧的外键），不能是 spaceSession.id：
    // 二者是不同的主键，用错会永远匹配不到
    const spaceSessionSpecMap = new Map(
      spaceSessionSpecs
        .filter((session) => session.saleOrderId !== null)
        .map((session) => [session.saleOrderId as number, session]),
    );
    const items = orders.map((order) => {
      const scanOrderId = order.scanOrderId;
      if (scanOrderId === null) {
        // 非扫码订单（空间会话结账）：回源 sessionItems 的行级规格
        const session = spaceSessionSpecMap.get(order.id);
        return mapSalesRecordResponse(
          order,
          session
            ? buildSpaceSessionSpecsEnrichment(order, session)
            : undefined,
        );
      }
      const scan = scanOrderingDetailMap.get(scanOrderId);
      return mapSalesRecordResponse(
        order,
        scan ? buildScanOrderingEnrichment(order, scan) : undefined,
      );
    });

    // 四个字段与 stats 接口同口径；列表侧不展示环比，故固定为 null
    const summary: SalesStatsResponseDto = {
      totalRevenue: stats.totalRevenue,
      totalProfit: stats.totalProfit,
      orderCount: stats.orderCount,
      avgOrderValue: stats.avgOrderValue,
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
