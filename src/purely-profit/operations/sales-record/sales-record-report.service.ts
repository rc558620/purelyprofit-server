import { Injectable } from '@nestjs/common';
import type { ServerResponse } from 'node:http';
import { Money } from '../../../shared/money.utils';
import { formatShanghaiDateTime } from '../../../shared/shanghai-time.utils';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import {
  isDeductionProductName,
  toOptionalText,
  toTimestampMs,
} from '../../commerce/commerce.utils';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PlatformMembershipAccessService } from '../../member/platform-membership/platform-membership-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  buildCacheRefreshTaskKey,
  buildSalesReportCacheKey,
} from '../../../redis/keys';
import { RefreshableCacheService } from '../../../redis/refreshable-cache.service';
import { buildGrouponLabel } from '../handover/handover.constants';
import type {
  SalesReportQueryDto,
  SalesReportResponseDto,
} from './dto/sales-record.dto';
import { aggregateReportRows } from './sales-record.domain';
import type { SaleOrderWithItems } from './sales-record.domain';
import { SalesRecordAmountsDomain } from './sales-record-amounts.domain';
import { querySaleOrders } from './sales-record.query';
import {
  buildEmptySalesReport,
  buildSalesCurrentRange,
} from './sales-record-read.utils';
import { safeStreamCsvExport } from '../../../shared/stream-export.utils';

const SALES_REPORT_CACHE_TTL_SECONDS = 60;
const SALES_REPORT_REFRESH_AFTER_MS = 15_000;

// ─── CSV 导出辅助 ─────────────────────────────────────────────────

const CSV_HEADERS = [
  '订单号',
  '商品名称',
  '数量(件)',
  '营业额(元)',
  '利润(元)',
  '支付方式',
  '团购平台',
  '券码',
  '操作员',
  '时间',
  '备注',
  '退款状态',
  '退款时间',
];

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: '现金',
  wechat: '微信',
  alipay: '支付宝',
  card: '刷卡',
  groupon_voucher: '团购券',
  other: '其他',
};

function formatCsvTimestamp(ms: number): string {
  return formatShanghaiDateTime(ms);
}

function resolvePaymentLabel(paymentMethod: string): string {
  return PAYMENT_METHOD_LABELS[paymentMethod] ?? paymentMethod;
}

function buildCsvRowFromOrder(order: SaleOrderWithItems): string[] {
  const visibleItems = order.items.filter(
    (item) => !isDeductionProductName(item.productName),
  );

  const preparedItems = visibleItems.map((item) => ({
    productId: item.productId,
    productName: item.productName,
    categoryName: item.categoryName,
    salePrice: Money.fromDbCents(item.salePrice),
    profit: Money.fromDbCents(item.profit),
    quantity: item.quantity,
    countsTowardTotalQuantity: true,
    image: undefined as string | undefined,
  }));

  const amounts =
    SalesRecordAmountsDomain.aggregateFromPreparedItems(preparedItems);

  const itemNames = visibleItems
    .map((it) => `${it.productName}×${it.quantity}`)
    .join('；');

  const operatorName = toOptionalText(order.operatorNameSnapshot) ?? '-';

  const note = toOptionalText(order.note) ?? '-';

  // 顾客使用团购券时，支付方式显示「XX团购」（平台名 + 团购），而非门店结算方式
  const effectivePaymentMethod =
    order.customerPaymentMethod === 'groupon_voucher'
      ? 'groupon_voucher'
      : order.paymentMethod;
  const paymentLabel =
    effectivePaymentMethod === 'groupon_voucher'
      ? buildGrouponLabel(order.grouponPlatform ?? order.voucherPlatform)
      : resolvePaymentLabel(effectivePaymentMethod);
  const grouponPlatform = toOptionalText(order.grouponPlatform) ?? '-';
  const voucherCode = toOptionalText(order.voucherCode) ?? '-';

  return [
    order.orderNo,
    itemNames,
    String(amounts.totalQuantity),
    String(amounts.totalRevenue),
    String(amounts.totalProfit),
    paymentLabel,
    grouponPlatform,
    voucherCode,
    operatorName,
    formatCsvTimestamp(toTimestampMs(order.date)),
    note,
    order.refund ? '已退款' : '正常',
    order.refund
      ? formatCsvTimestamp(toTimestampMs(order.refund.refundedAt))
      : '-',
  ];
}

function resolvePeriodLabel(query: SalesReportQueryDto): string {
  const period = query.period ?? 'today';
  const periodMap: Record<string, string> = {
    today: '今日',
    week: '本周',
    month: '本月',
    quarter: '本季',
    year: '今年',
    custom_month: query.customDate
      ? formatCsvTimestamp(query.customDate).slice(0, 10)
      : '自定义',
    custom_range:
      query.rangeStartDate && query.rangeEndDate
        ? `${formatCsvTimestamp(query.rangeStartDate).slice(0, 10)}–${formatCsvTimestamp(query.rangeEndDate).slice(0, 10)}`
        : '自定义范围',
  };
  return periodMap[period] ?? period;
}

function buildSummaryPrefixRows(
  orders: SaleOrderWithItems[],
  periodLabel: string,
): unknown[][] {
  const now = Date.now();
  const exportTime = formatCsvTimestamp(now);

  let totalRevenue = 0;
  let totalProfit = 0;

  for (const order of orders) {
    if (order.refund) continue;
    const visibleItems = order.items.filter(
      (item) => !isDeductionProductName(item.productName),
    );
    const preparedItems = visibleItems.map((item) => ({
      productId: item.productId,
      productName: item.productName,
      categoryName: item.categoryName,
      salePrice: Money.fromDbCents(item.salePrice),
      profit: Money.fromDbCents(item.profit),
      quantity: item.quantity,
      countsTowardTotalQuantity: true,
      image: undefined as string | undefined,
    }));
    const amounts =
      SalesRecordAmountsDomain.aggregateFromPreparedItems(preparedItems);
    totalRevenue = Money.fromInputYuan(totalRevenue)
      .add(Money.fromInputYuan(amounts.totalRevenue))
      .toOutputYuan();
    totalProfit = Money.fromInputYuan(totalProfit)
      .add(Money.fromInputYuan(amounts.totalProfit))
      .toOutputYuan();
  }

  const orderCount = orders.filter((order) => !order.refund).length;
  const avgOrderValue =
    orderCount > 0
      ? Money.fromInputYuan(totalRevenue).divide(orderCount).toOutputYuan()
      : 0;

  return [
    ['销售记录报表', '', '', `导出时间: ${exportTime}`],
    [],
    ['【统计汇总】'],
    ['筛选周期', '总营业额(元)', '总利润(元)', '订单笔数', '平均客单价(元)'],
    [
      periodLabel,
      String(totalRevenue),
      String(totalProfit),
      String(orderCount),
      String(avgOrderValue),
    ],
    [],
    ['【订单明细】'],
  ];
}

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
      const prefixRows = buildSummaryPrefixRows([], resolvePeriodLabel(query));
      safeStreamCsvExport(
        reply,
        'sales-record.csv',
        CSV_HEADERS,
        [],
        prefixRows,
      );
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
      const prefixRows = buildSummaryPrefixRows([], resolvePeriodLabel(query));
      safeStreamCsvExport(
        reply,
        'sales-record.csv',
        CSV_HEADERS,
        [],
        prefixRows,
      );
      return;
    }

    const orders = await querySaleOrders(this.prisma, {
      storeId,
      range: { start: range.start, end: range.end },
    });

    const rows = orders.map((order) => buildCsvRowFromOrder(order));
    const periodLabel = resolvePeriodLabel(query);
    const prefixRows = buildSummaryPrefixRows(orders, periodLabel);

    safeStreamCsvExport(
      reply,
      'sales-record.csv',
      CSV_HEADERS,
      rows,
      prefixRows,
    );
  }
}
