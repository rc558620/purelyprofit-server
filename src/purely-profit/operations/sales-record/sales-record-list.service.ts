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
import { buildPaginationMeta } from '../../commerce/commerce.utils';
import {
  encodeSalesRecordListCursor,
  resolveSalesRecordListPaging,
} from './sales-record-list.cursor';
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

    // 入参校验先于取数：cursor 非法时直接 400，不白跑任何查询
    const paging = resolveSalesRecordListPaging(
      query,
      this.resolvePagingBounds(),
    );

    if (storeId === null) {
      return buildEmptySalesListResponse(paging.page, paging.limit);
    }

    const callerIsSubAccount =
      user.currentMembership?.subjectType === 'sub_account';
    const range = await this.platformMembershipAccessService.clampHistoryRange(
      storeId,
      buildSalesCurrentRange(query),
      callerIsSubAccount,
    );
    if (range.empty) {
      return buildEmptySalesListResponse(paging.page, paging.limit);
    }

    // 分页数据、「总数」与「汇总」三者互不依赖，提前一并发出，
    // 避免总查询耗时变成各查询串行累加。
    const ordersPromise = querySaleOrders(this.prisma, {
      storeId,
      range: { start: range.start, end: range.end },
      skip: paging.offset,
      // 游标路径多取一行做「是否还有下一页」探测，省掉一次额外查询
      take: paging.cursor ? paging.limit + 1 : paging.limit,
      listCursor: paging.cursor,
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

    const fetchedOrders = await ordersPromise;
    // 游标路径多取的那一行只用于探测「还有下一页」，不参与本页映射与增强查询，
    // 否则会多查一次扫码订单/规格明细却把结果丢掉。
    const pageOrders = paging.cursor
      ? fetchedOrders.slice(0, paging.limit)
      : fetchedOrders;
    // 收集扫码点餐订单 ID（仅餐饮账号的扫码订单存在，普通订单为空）
    const scanOrderIds = pageOrders
      .map((order) => order.scanOrderId)
      .filter((id): id is number => id !== null && id !== undefined);
    // 收集非扫码订单 ID（空间会话结账订单：自助下单 / 追加点单，用于规格展示）。
    // querySaleOrders 已把 spaceSession 一并查出，只有存在会话的订单才可能在
    // space_sessions / session_items 中命中规格行；先收窄再查，避免把整页
    // 普通销售单 ID 塞进 IN 列表做无谓的索引扫描与关联行读取。
    const nonScanSaleOrderIds = pageOrders
      .filter(
        (order) => order.scanOrderId === null && order.spaceSession !== null,
      )
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
    const items = pageOrders.map((order) => {
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

    /*
     * 到底判定分两条路径（与 costs / members 等已迁移列表同一口径）：
     * - 游标路径：探测行 `limit + 1` 的存在即代表还有下一页；
     * - offset 路径：没有探测行，只能用 `offset + 已取条数 < total` 推导。
     * 两条路径都产出 nextCursor，前端可逐步从 page 切到游标而不必等后端改造。
     */
    const hasMore = paging.cursor
      ? fetchedOrders.length > paging.limit
      : paging.offset + pageOrders.length < total;
    const lastOrder = pageOrders.at(-1);

    return {
      items,
      meta: buildPaginationMeta(total, paging.page, paging.limit),
      summary,
      hasMore,
      nextCursor:
        hasMore && lastOrder ? encodeSalesRecordListCursor(lastOrder) : null,
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

  /** 每页条数边界：defaultPageSize/maxPageSize 沿用配置，不因迁移放大 */
  private resolvePagingBounds(): {
    defaultPageSize: number;
    maxPageSize: number;
  } {
    return {
      defaultPageSize:
        this.configService.get<number>('app.defaultPageSize') ?? 20,
      maxPageSize: this.configService.get<number>('app.maxPageSize') ?? 100,
    };
  }
}
