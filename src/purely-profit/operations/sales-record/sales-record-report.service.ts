import { Injectable } from '@nestjs/common';
import type { ServerResponse } from 'node:http';
import { Money } from '../../../shared/money.utils';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { isDeductionProductName } from '../../commerce/commerce.utils';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PlatformMembershipAccessService } from '../../member/platform-membership/platform-membership-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  buildCacheRefreshTaskKey,
  buildSalesReportCacheKey,
} from '../../../redis/keys';
import { RefreshableCacheService } from '../../../redis/refreshable-cache.service';
import type {
  SalesReportQueryDto,
  SalesReportResponseDto,
} from './dto/sales-record.dto';
import {
  buildScanOrderingEnrichment,
  buildSpaceSessionSpecsEnrichment,
} from './sales-record-enrichment';
import { aggregateReportRows } from './sales-record-report-aggregation';
import {
  streamSalesReportCsv,
  type SalesReportSpecsRowsMap,
} from './sales-record-report-csv';
import type { SaleOrderWithItems } from './sales-record.domain';
import {
  querySaleOrders,
  queryScanOrderingDetails,
  querySpaceSessionSpecDetails,
} from './sales-record.query';
import {
  buildEmptySalesReport,
  buildSalesCurrentRange,
} from './sales-record-read.utils';

const SALES_REPORT_CACHE_TTL_SECONDS = 60;
const SALES_REPORT_REFRESH_AFTER_MS = 15_000;

@Injectable()
export class SalesRecordReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly refreshableCache: RefreshableCacheService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly platformMembershipAccessService: PlatformMembershipAccessService,
  ) {}

  async getReport(
    user: AuthenticatedUser,
    query: SalesReportQueryDto,
  ): Promise<SalesReportResponseDto> {
    const storeId = await this.commerceAccessService.resolveViewStoreId(
      user,
      query.storeId,
      'report:view',
      '无权查看该门店销售报表',
    );

    if (storeId === null) {
      return buildEmptySalesReport();
    }

    const callerIsSubAccount =
      user.currentMembership?.subjectType === 'sub_account';
    if (query.export) {
      await this.platformMembershipAccessService.ensureReportExportEnabled(
        storeId,
        callerIsSubAccount,
      );
    }

    const cacheKey = buildSalesReportCacheKey(storeId, {
      scope: callerIsSubAccount ? 'sub_account' : 'owner',
      period: query.period,
      year: query.year,
      customDate:
        query.customDate !== undefined ? String(query.customDate) : undefined,
      rangeStartDate:
        query.rangeStartDate !== undefined
          ? String(query.rangeStartDate)
          : undefined,
      rangeEndDate:
        query.rangeEndDate !== undefined
          ? String(query.rangeEndDate)
          : undefined,
    });

    return this.refreshableCache.getOrLoadRefreshableJson({
      cacheKey,
      taskKey: buildCacheRefreshTaskKey(cacheKey),
      ttlSeconds: SALES_REPORT_CACHE_TTL_SECONDS,
      refreshAfterMs: SALES_REPORT_REFRESH_AFTER_MS,
      loadValue: () => this.buildReport(storeId, callerIsSubAccount, query),
      refreshValue: () => this.buildReport(storeId, callerIsSubAccount, query),
    });
  }

  private async buildReport(
    storeId: number,
    callerIsSubAccount: boolean,
    query: SalesReportQueryDto,
  ): Promise<SalesReportResponseDto> {
    const range = await this.platformMembershipAccessService.clampHistoryRange(
      storeId,
      buildSalesCurrentRange(query),
      callerIsSubAccount,
    );
    if (range.empty) {
      return buildEmptySalesReport();
    }

    const orders = await querySaleOrders(this.prisma, {
      storeId,
      range: { start: range.start, end: range.end },
    });

    // 从 items 重新聚合 totalQuantity，排除预付款行
    const totalQuantity = orders.reduce(
      (sum, order) =>
        sum +
        order.items
          .filter((item) => !isDeductionProductName(item.productName))
          .reduce((acc, item) => acc + item.quantity, 0),
      0,
    );
    // 从 items 重新聚合 totalRevenue，排除预付款行
    const totalRevenue = Money.sum(
      orders.flatMap((order) =>
        order.items
          .filter((item) => !isDeductionProductName(item.productName))
          .map((item) =>
            Money.fromDbCents(item.salePrice).multiply(item.quantity),
          ),
      ),
    ).toOutputYuan();
    const dailySales = aggregateReportRows(orders);
    // orderCount 应为原始订单笔数，而非按 (日期+商品) 聚合后的行数
    const orderCount = orders.length;

    return {
      summary: {
        totalQuantity,
        totalRevenue,
        orderCount,
        avgOrderValue:
          orderCount > 0
            ? Money.fromInputYuan(totalRevenue)
                .divide(orderCount)
                .toOutputYuan()
            : 0,
      },
      dailySales,
    };
  }

  /**
   * 流式导出销售记录 CSV，O(1) 内存占用。
   * 导出内容与页面订单列表一致：逐笔订单，包含订单号、商品、件数、营业额、利润、支付方式、操作员、结算状态、时间、备注。
   */
  async streamReportCsv(
    reply: ServerResponse,
    user: AuthenticatedUser,
    query: SalesReportQueryDto,
  ): Promise<void> {
    const storeId = await this.commerceAccessService.resolveViewStoreId(
      user,
      query.storeId,
      'report:view',
      '无权查看该门店销售报表',
    );

    if (storeId === null) {
      streamSalesReportCsv(reply, [], query);
      return;
    }

    const callerIsSubAccount =
      user.currentMembership?.subjectType === 'sub_account';
    await this.platformMembershipAccessService.ensureReportExportEnabled(
      storeId,
      callerIsSubAccount,
    );

    const range = await this.platformMembershipAccessService.clampHistoryRange(
      storeId,
      buildSalesCurrentRange(query),
      callerIsSubAccount,
    );
    if (range.empty) {
      streamSalesReportCsv(reply, [], query);
      return;
    }

    const orders = await querySaleOrders(this.prisma, {
      storeId,
      range: { start: range.start, end: range.end },
    });

    const specsRowsMap = await this.resolveSpecsRowsMap(orders);

    streamSalesReportCsv(reply, orders, query, specsRowsMap);
  }

  /**
   * 批量解析订单规格行（订单 id → 与 `order.items` 原始索引对齐的规格名列表）。
   *
   * 与销售记录列表接口同口径，两种来源分别回源：
   * - 扫码点餐订单：`scanOrder.items.specs`（按数量展开）
   * - 空间会话结账订单（自助下单 / 追加点单）：`spaceSession.sessionItems.specNames`（行级）
   *
   * 未命中（无规格 / 数据缺失）时不写入 map，调用方按「无规格」渲染。
   */
  private async resolveSpecsRowsMap(
    orders: SaleOrderWithItems[],
  ): Promise<SalesReportSpecsRowsMap> {
    const specsRowsMap: SalesReportSpecsRowsMap = new Map();
    if (orders.length === 0) return specsRowsMap;

    const scanOrderIds = orders
      .map((order) => order.scanOrderId)
      .filter((id): id is number => id !== null && id !== undefined);
    const nonScanSaleOrderIds = orders
      .filter((order) => order.scanOrderId === null)
      .map((order) => order.id);

    const [scanDetails, spaceSessionSpecs] = await Promise.all([
      queryScanOrderingDetails(this.prisma, scanOrderIds),
      querySpaceSessionSpecDetails(this.prisma, nonScanSaleOrderIds),
    ]);
    const scanDetailMap = new Map(
      scanDetails.map((detail) => [detail.id, detail]),
    );
    // key 必须是 SaleOrder.id（会话侧外键），不能用 spaceSession.id
    const spaceSessionMap = new Map(
      spaceSessionSpecs
        .filter((session) => session.saleOrderId !== null)
        .map((session) => [session.saleOrderId as number, session]),
    );

    for (const order of orders) {
      if (order.scanOrderId !== null) {
        const detail = scanDetailMap.get(order.scanOrderId);
        if (detail) {
          specsRowsMap.set(
            order.id,
            buildScanOrderingEnrichment(order, detail).specsRows,
          );
        }
        continue;
      }
      const session = spaceSessionMap.get(order.id);
      if (session) {
        specsRowsMap.set(
          order.id,
          buildSpaceSessionSpecsEnrichment(order, session).specsRows,
        );
      }
    }

    return specsRowsMap;
  }
}
