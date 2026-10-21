import { Injectable } from '@nestjs/common';
import type { ServerResponse } from 'node:http';
import { Money } from '../../../shared/money.utils';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
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
  accumulateSalesReportCsvSummary,
  buildCsvRowFromOrder,
  resolvePeriodLabel,
  startSalesReportCsv,
  streamSalesReportCsv,
  writeSalesReportCsvRows,
  type SalesReportCsvSummary,
  type SalesReportSpecsRowsMap,
} from './sales-record-report-csv';
import {
  resolveSalesRecordAmountsFromOrder,
  type SaleOrderWithItems,
  type SalesRecordOrderAmounts,
} from './sales-record.domain';
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

/**
 * CSV 导出的分批大小。
 *
 * 导出按 keyset 游标分批取订单，常驻内存只保留这一批，避免大门店「导出全部」
 * 时把全店历史订单一次性读进堆内存。取 500 是兼顾往返次数与单批内存的经验值。
 */
const SALES_REPORT_CSV_BATCH_SIZE = 500;

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

    // 订单级金额统一口径（与列表 / CSV 导出完全一致）：
    // 台位费计入金额、团购券订单按券面 + 超时 + 点单计收。
    // 已退款订单不计入（与列表卡片 +¥0、CSV 汇总、统计卡同口径）。
    const amountsByOrderId = new Map<number, SalesRecordOrderAmounts>();
    for (const order of orders) {
      if (order.refund) continue;
      amountsByOrderId.set(
        Number(order.id),
        resolveSalesRecordAmountsFromOrder(order),
      );
    }
    const orderAmounts = Array.from(amountsByOrderId.values());
    const totalQuantity = orderAmounts.reduce(
      (sum, amounts) => sum + amounts.totalQuantity,
      0,
    );
    const totalRevenue = orderAmounts.reduce(
      (sum, amounts) =>
        Money.fromInputYuan(sum)
          .add(Money.fromInputYuan(amounts.totalRevenue))
          .toOutputYuan(),
      0,
    );
    // 商品明细沿用同一份订单级金额，保证明细营业额合计 = 汇总营业额
    const dailySales = aggregateReportRows(orders, amountsByOrderId);
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

    /*
     * 统计汇总行写在文件头部，金额却要由全部订单累加——因此导出不能简单地
     * 「边查边写」。这里改成两趟 keyset 分批扫描：
     *   第一趟：分批取、累加营业额/利润/笔数，算完即弃；
     *   第二趟：按同样顺序分批取，边取边写响应。
     * 两趟都走 querySaleOrders + resolveSalesRecordAmountsFromOrder，
     * 与一次性导出的计算结果同源，导出内容逐字节一致。
     * 代价是多扫一遍（导出是低频操作），换来 O(批量) 而非 O(全量) 的常驻内存，
     * 避免大门店「导出全部」打爆堆内存。
     */
    const summary = await this.accumulateCsvSummary(storeId, range);

    const periodLabel = resolvePeriodLabel(query);
    try {
      startSalesReportCsv(reply, summary, periodLabel);

      let cursor: { id: number } | undefined;
      // 批次循环：取满一批就续游标，取不满说明已到末尾
      for (;;) {
        const orders = await querySaleOrders(this.prisma, {
          storeId,
          range: { start: range.start, end: range.end },
          cursor,
          take: SALES_REPORT_CSV_BATCH_SIZE,
        });
        if (orders.length === 0) break;

        const specsRowsMap = await this.resolveSpecsRowsMap(orders);
        writeSalesReportCsvRows(
          reply,
          orders.map((order) =>
            buildCsvRowFromOrder(order, specsRowsMap.get(order.id)),
          ),
        );

        if (orders.length < SALES_REPORT_CSV_BATCH_SIZE) break;
        cursor = { id: orders[orders.length - 1].id };
      }
    } finally {
      // 响应头与汇总行已写出，异常时无法再回 JSON，只能关闭连接
      reply.end();
    }
  }

  /**
   * 第一趟扫描：用与一次性导出完全相同的口径累加统计汇总。
   *
   * 分批取值、算完即弃，常驻内存只保留一批订单。
   */
  private async accumulateCsvSummary(
    storeId: number,
    range: { start: number; end: number },
  ): Promise<SalesReportCsvSummary> {
    let summary = accumulateSalesReportCsvSummary([]);
    let cursor: { id: number } | undefined;

    for (;;) {
      const orders = await querySaleOrders(this.prisma, {
        storeId,
        range: { start: range.start, end: range.end },
        cursor,
        take: SALES_REPORT_CSV_BATCH_SIZE,
      });
      if (orders.length === 0) break;

      const batch = accumulateSalesReportCsvSummary(orders);
      summary = {
        totalRevenue: Money.fromInputYuan(summary.totalRevenue)
          .add(Money.fromInputYuan(batch.totalRevenue))
          .toOutputYuan(),
        totalProfit: Money.fromInputYuan(summary.totalProfit)
          .add(Money.fromInputYuan(batch.totalProfit))
          .toOutputYuan(),
        orderCount: summary.orderCount + batch.orderCount,
        avgOrderValue: 0,
      };

      if (orders.length < SALES_REPORT_CSV_BATCH_SIZE) break;
      cursor = { id: orders[orders.length - 1].id };
    }

    // 客单价必须在总额累加完之后再算：分批相除会引入多次取整误差
    return {
      ...summary,
      avgOrderValue:
        summary.orderCount > 0
          ? Money.fromInputYuan(summary.totalRevenue)
              .divide(summary.orderCount)
              .toOutputYuan()
          : 0,
    };
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
