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
import {
  isSelfOrderDeductionRow,
  listVisibleSaleOrderItems,
} from './sales-record-item-aggregation';
import {
  buildGrouponLabel,
  resolveGrouponPlatformZh,
} from '../handover/handover.constants';
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
  resolveReportProductName,
  type SaleOrderWithItems,
} from './sales-record.domain';
import { SalesRecordAmountsDomain } from './sales-record-amounts.domain';
import {
  querySaleOrders,
  queryScanOrderingDetails,
  querySpaceSessionSpecDetails,
} from './sales-record.query';
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
  '商品（规格）',
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

/**
 * @param specsRows 与 `order.items` **原始索引**一一对应的规格名列表（来自 resolveSpecsRowsMap）；
 *                  缺省表示该订单无规格可展示。
 */
export function buildCsvRowFromOrder(
  order: SaleOrderWithItems,
  specsRows?: string[][],
): string[] {
  // 金额聚合口径：商品行 + 抵扣行相互冲减（自助下单商品已在线支付，抵扣行冲减到店应收）
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

  // 商品名称列：自助下单已在线支付的商品由「XX · 自助下单抵扣」抵扣行承载（原商品行排除）；
  // 规格按 **order.items 原始索引**取值（行过滤后再取下标会错位），
  // 输出格式与餐饮 CSV 一致：商品名×数量（规格1、规格2）
  const itemNames = listVisibleSaleOrderItems(order)
    .map(({ item, index }) => {
      const specs = specsRows?.[index] ?? [];
      const specSuffix = specs.length > 0 ? `（${specs.join('、')}）` : '';
      // 抵扣行保留完整名（「XX · 自助下单抵扣」），不做报表名改写
      const name = isSelfOrderDeductionRow(item.productName)
        ? item.productName
        : resolveReportProductName(order, item);
      return `${name}×${item.quantity}${specSuffix}`;
    })
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
  // 团购平台列：拼音/英文标识映射为中文平台名（如 chunlibao → 纯利宝）
  const grouponPlatform = toOptionalText(order.grouponPlatform)
    ? resolveGrouponPlatformZh(order.grouponPlatform)
    : '-';
  const voucherCode = toOptionalText(order.voucherCode) ?? '-';

  return [
    order.orderNo,
    itemNames,
    // \t 前缀强制 Excel/WPS 按文本处理，避免数字/日期类型因列宽不足显示 ####
    `\t${String(amounts.totalQuantity)}`,
    `\t${String(amounts.totalRevenue)}`,
    `\t${String(amounts.totalProfit)}`,
    paymentLabel,
    grouponPlatform,
    voucherCode,
    operatorName,
    `\t${formatCsvTimestamp(toTimestampMs(order.date))}`,
    note,
    order.refund ? '已退款' : '正常',
    order.refund
      ? `\t${formatCsvTimestamp(toTimestampMs(order.refund.refundedAt))}`
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
      safeStreamCsvExport(reply, '销售记录.csv', CSV_HEADERS, [], prefixRows);
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
      safeStreamCsvExport(reply, '销售记录.csv', CSV_HEADERS, [], prefixRows);
      return;
    }

    const orders = await querySaleOrders(this.prisma, {
      storeId,
      range: { start: range.start, end: range.end },
    });

    const specsRowsMap = await this.resolveSpecsRowsMap(orders);
    const rows = orders.map((order) =>
      buildCsvRowFromOrder(order, specsRowsMap.get(order.id)),
    );
    const periodLabel = resolvePeriodLabel(query);
    const prefixRows = buildSummaryPrefixRows(orders, periodLabel);

    safeStreamCsvExport(reply, '销售记录.csv', CSV_HEADERS, rows, prefixRows);
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
  ): Promise<Map<number, string[][]>> {
    const specsRowsMap = new Map<number, string[][]>();
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
