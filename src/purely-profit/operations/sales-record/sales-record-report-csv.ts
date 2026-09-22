// 销售报表 CSV 导出：表头、订单明细行渲染、统计汇总前缀行与流式写出。
import type { ServerResponse } from 'node:http';
import { Money } from '../../../shared/money.utils';
import { formatShanghaiDateTime } from '../../../shared/shanghai-time.utils';
import { safeStreamCsvExport } from '../../../shared/stream-export.utils';
import {
  isDeductionProductName,
  toOptionalText,
  toTimestampMs,
} from '../../commerce/commerce.utils';
import {
  buildGrouponLabel,
  resolveGrouponPlatformZh,
} from '../handover/handover.constants';
import type { SalesReportQueryDto } from './dto/sales-record.dto';
import {
  isSelfOrderDeductionRow,
  listVisibleSaleOrderItems,
} from './sales-record-item-aggregation';
import {
  resolveReportProductName,
  type SaleOrderWithItems,
} from './sales-record.domain';
import { SalesRecordAmountsDomain } from './sales-record-amounts.domain';

const CSV_FILENAME = '销售记录.csv';

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

/** 订单 id → 与 `order.items` 原始索引对齐的规格名列表。 */
export type SalesReportSpecsRowsMap = Map<number, string[][]>;

function formatCsvTimestamp(ms: number): string {
  return formatShanghaiDateTime(ms);
}

function resolvePaymentLabel(paymentMethod: string): string {
  return PAYMENT_METHOD_LABELS[paymentMethod] ?? paymentMethod;
}

/**
 * 金额聚合口径：商品行 + 抵扣行相互冲减（自助下单商品已在线支付，抵扣行冲减到店应收）。
 * 排除抵扣行后按统一口径准备金额聚合入参。
 */
function aggregateOrderAmounts(order: SaleOrderWithItems) {
  const preparedItems = order.items
    .filter((item) => !isDeductionProductName(item.productName))
    .map((item) => ({
      productId: item.productId,
      productName: item.productName,
      categoryName: item.categoryName,
      salePrice: Money.fromDbCents(item.salePrice),
      profit: Money.fromDbCents(item.profit),
      quantity: item.quantity,
      countsTowardTotalQuantity: true,
      image: undefined as string | undefined,
    }));

  return SalesRecordAmountsDomain.aggregateFromPreparedItems(preparedItems);
}

/**
 * @param specsRows 与 `order.items` **原始索引**一一对应的规格名列表（来自 resolveSpecsRowsMap）；
 *                  缺省表示该订单无规格可展示。
 */
export function buildCsvRowFromOrder(
  order: SaleOrderWithItems,
  specsRows?: string[][],
): string[] {
  const amounts = aggregateOrderAmounts(order);

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

export function resolvePeriodLabel(query: SalesReportQueryDto): string {
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
  const exportTime = formatCsvTimestamp(Date.now());

  let totalRevenue = 0;
  let totalProfit = 0;

  for (const order of orders) {
    if (order.refund) continue;
    const amounts = aggregateOrderAmounts(order);
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

/** 按订单逐行渲染 CSV 明细行。 */
export function buildSalesReportCsvRows(
  orders: SaleOrderWithItems[],
  specsRowsMap: SalesReportSpecsRowsMap = new Map(),
): string[][] {
  return orders.map((order) =>
    buildCsvRowFromOrder(order, specsRowsMap.get(order.id)),
  );
}

/** 流式导出销售记录 CSV：统计汇总前缀 + 订单明细表头 + 明细行。 */
export function streamSalesReportCsv(
  reply: ServerResponse,
  orders: SaleOrderWithItems[],
  query: SalesReportQueryDto,
  specsRowsMap?: SalesReportSpecsRowsMap,
): void {
  safeStreamCsvExport(
    reply,
    CSV_FILENAME,
    CSV_HEADERS,
    buildSalesReportCsvRows(orders, specsRowsMap),
    buildSummaryPrefixRows(orders, resolvePeriodLabel(query)),
  );
}
