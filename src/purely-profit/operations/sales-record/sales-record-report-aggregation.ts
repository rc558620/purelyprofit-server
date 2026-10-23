// 销售报表行聚合：按「营业日 + 商品」汇总数量与营业额（排除抵扣行）
import {
  isNonQuantitySalesRecordRow,
  TABLE_FEE_NAME_RE,
} from '../../commerce/commerce.utils';
import { Money } from '../../../shared/money.utils';
import {
  formatShanghaiDayLabel,
  getShanghaiDayStartMs,
} from '../../../shared/shanghai-time.utils';
import type { SalesDailyRowDto } from './dto/sales-record-response.dto';
import {
  isSelfOrderDeductionRow,
  listVisibleSaleOrderItems,
} from './sales-record-item-aggregation';
import {
  resolveReportProductName,
  type SaleOrderWithItems,
  type SalesRecordOrderAmounts,
} from './sales-record.domain';

export interface SalesReportAggregationRow {
  id: string;
  dateLabel: string;
  productName: string;
  quantity: number;
  revenue: number;
}

function formatReportMonthDay(timestamp: number): string {
  return formatShanghaiDayLabel(timestamp);
}

function getDayStart(timestamp: number): number {
  return getShanghaiDayStartMs(timestamp);
}

function buildReportRowId(
  dayStart: number,
  item: SaleOrderWithItems['items'][number],
  displayName: string,
): string {
  if (displayName !== item.productName) {
    return `${dayStart}-space_${displayName}`;
  }

  return `${dayStart}-${item.productId ?? `manual_${displayName}`}`;
}

function getReportRowDayStart(rowId: string): number {
  // rowId 格式为 "${dayStart}-${...}"，dayStart 是毫秒时间戳（纯数字），
  // 取第一个连字符之前的部分即可安全解析。
  const separatorIndex = rowId.indexOf('-');
  if (separatorIndex === -1) {
    return 0;
  }
  return Number(rowId.slice(0, separatorIndex));
}

/**
 * 团购券订单台位费行的金额折损系数（0 < scale ≤ 1）。
 *
 * 券只按它实际抵消的台位费计收（min(台位费, 券程, 券面)），多付的券面留在券余额、
 * 不计入本单。明细行必须与汇总（resolveSalesRecordAmounts）同口径，否则报表页会
 * 出现「商品明细营业额合计 > 总营业额」的自相矛盾。
 */
function resolveTableFeeRevenueScale(
  order: SaleOrderWithItems,
  amounts: SalesRecordOrderAmounts | undefined,
): number {
  const breakdown = amounts?.grouponVoucherBreakdown;
  if (!breakdown) return 1;

  const rawTableFee = listVisibleSaleOrderItems(order).reduce(
    (sum, { item }) =>
      TABLE_FEE_NAME_RE.test(item.productName)
        ? sum.add(Money.fromDbCents(item.salePrice).multiply(item.quantity))
        : sum,
    Money.zero(),
  );
  if (!rawTableFee.isPositive()) return 1;

  const adjusted = Money.fromInputYuan(breakdown.voucherCoveredRevenue).add(
    Money.fromInputYuan(breakdown.overtimeRevenue),
  );
  return Math.min(1, adjusted.toDbCents() / rawTableFee.toDbCents());
}

export function aggregateReportRows(
  orders: SaleOrderWithItems[],
  amountsByOrderId: Map<number, SalesRecordOrderAmounts> = new Map(),
): SalesDailyRowDto[] {
  const rows = new Map<string, SalesReportAggregationRow>();

  for (const order of orders) {
    // 已退款订单不计入（与汇总 / CSV 汇总 / 统计卡同口径）
    if (order.refund) continue;
    const tableFeeScale = resolveTableFeeRevenueScale(
      order,
      amountsByOrderId.get(Number(order.id)),
    );
    const dayStart = getDayStart(order.date.getTime());
    const dateLabel = formatReportMonthDay(dayStart);

    // 与列表 / CSV 导出同口径：listVisibleSaleOrderItems 已排除
    // 预付款/续费抵扣行，并把自助下单已支付的原商品行收敛到唯一的抵扣行，
    // 避免同一笔消费同时计入「商品行 + 抵扣行」导致件数与营业额重复。
    for (const { item } of listVisibleSaleOrderItems(order)) {
      // 抵扣行保留完整名（「XX · 自助下单抵扣」），与 CSV 导出保持一致
      const productName = isSelfOrderDeductionRow(item.productName)
        ? item.productName
        : resolveReportProductName(order, item);
      const rowId = buildReportRowId(dayStart, item, productName);
      const isTableFeeRow = TABLE_FEE_NAME_RE.test(item.productName);
      const rawRevenue = Money.fromDbCents(item.salePrice).multiply(
        item.quantity,
      );
      // 团购券订单：台位费行按「券实际抵扣 + 超时」计收，与汇总同口径
      const revenue = isTableFeeRow
        ? rawRevenue.multiply(tableFeeScale).toOutputYuan()
        : rawRevenue.toOutputYuan();
      const existing = rows.get(rowId);
      if (existing) {
        // 抵扣行 / 台位费行不是真实销量，累加数量会虚高
        existing.quantity += isNonQuantitySalesRecordRow(
          item.productName,
          item.categoryName,
        )
          ? 0
          : item.quantity;
        existing.revenue = Money.fromInputYuan(existing.revenue)
          .add(Money.fromInputYuan(revenue))
          .toOutputYuan();
        continue;
      }
      rows.set(rowId, {
        id: rowId,
        dateLabel,
        productName,
        // 抵扣行 / 台位费行不是真实销量，需要展示但件数计 0
        quantity: isNonQuantitySalesRecordRow(
          item.productName,
          item.categoryName,
        )
          ? 0
          : item.quantity,
        revenue,
      });
    }
  }

  return Array.from(rows.values()).sort((left, right) => {
    // 主要排序：日期降序（保持当前日期排序）
    const leftDayStart = getReportRowDayStart(left.id);
    const rightDayStart = getReportRowDayStart(right.id);
    if (leftDayStart !== rightDayStart) {
      return rightDayStart - leftDayStart;
    }

    // 次要排序：数量降序（同日期内卖得最多的在最顶部）
    if (left.quantity !== right.quantity) {
      return right.quantity - left.quantity;
    }

    if (left.id === right.id) {
      return 0;
    }
    return left.id > right.id ? -1 : 1;
  });
}
