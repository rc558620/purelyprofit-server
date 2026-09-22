// 销售报表行聚合：按「营业日 + 商品」汇总数量与营业额（排除抵扣行）
import { isDeductionProductName } from '../../commerce/commerce.utils';
import { Money } from '../../../shared/money.utils';
import {
  formatShanghaiDayLabel,
  getShanghaiDayStartMs,
} from '../../../shared/shanghai-time.utils';
import type { SalesDailyRowDto } from './dto/sales-record-response.dto';
import {
  resolveReportProductName,
  type SaleOrderWithItems,
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
  order: SaleOrderWithItems,
  item: SaleOrderWithItems['items'][number],
): string {
  const displayName = resolveReportProductName(order, item);
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

export function aggregateReportRows(
  orders: SaleOrderWithItems[],
): SalesDailyRowDto[] {
  const rows = new Map<string, SalesReportAggregationRow>();

  for (const order of orders) {
    const dayStart = getDayStart(order.date.getTime());
    const dateLabel = formatReportMonthDay(dayStart);

    for (const item of order.items) {
      // 排除抵扣行（预付款 + 续费抵扣），报表只展示实际消费
      if (isDeductionProductName(item.productName)) {
        continue;
      }

      const productName = resolveReportProductName(order, item);
      const rowId = buildReportRowId(dayStart, order, item);
      const revenue = Money.fromDbCents(item.salePrice)
        .multiply(item.quantity)
        .toOutputYuan();
      const existing = rows.get(rowId);
      if (existing) {
        existing.quantity += item.quantity;
        existing.revenue = Money.fromInputYuan(existing.revenue)
          .add(Money.fromInputYuan(revenue))
          .toOutputYuan();
        continue;
      }
      rows.set(rowId, {
        id: rowId,
        dateLabel,
        productName,
        quantity: item.quantity,
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
