import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  toDecimalNumber,
  toOptionalText,
  toTimestampMs,
} from '../../commerce/commerce.utils';
import type {
  SalesDailyRowDto,
  SalesRecordItemResponseDto,
  SalesRecordResponseDto,
} from './dto/sales-record.dto';
import { isSameMoney, sumMoney } from './sales-record.utils';

// ---------------------------------------------------------------------------
// 内部类型
// ---------------------------------------------------------------------------

export interface SalesReportAggregationRow {
  id: string;
  dateLabel: string;
  productName: string;
  quantity: number;
  revenue: number;
}

export type SaleOrderWithItems = Prisma.SaleOrderGetPayload<{
  include: {
    items: {
      orderBy: [{ id: 'asc' }];
    };
  };
}>;

// ---------------------------------------------------------------------------
// 校验断言
// ---------------------------------------------------------------------------

export function assertSalesTotalsMatch(
  dto: { totalRevenue: number; totalProfit: number; totalQuantity: number },
  totalRevenue: number,
  totalProfit: number,
  totalQuantity: number,
): void {
  if (!isSameMoney(dto.totalRevenue, totalRevenue)) {
    throw new BadRequestException('总营业额与明细汇总不一致');
  }
  if (!isSameMoney(dto.totalProfit, totalProfit)) {
    throw new BadRequestException('总利润与明细汇总不一致');
  }
  if (dto.totalQuantity !== totalQuantity) {
    throw new BadRequestException('总销售件数与明细汇总不一致');
  }
}

// ---------------------------------------------------------------------------
// 响应映射
// ---------------------------------------------------------------------------

export function mapSalesRecordResponse(
  order: SaleOrderWithItems,
): SalesRecordResponseDto {
  const note = toOptionalText(order.note);

  return {
    id: String(order.id),
    orderNo: order.orderNo,
    items: order.items.map((item) => mapSalesRecordItemResponse(item)),
    totalRevenue: toDecimalNumber(order.totalRevenue),
    totalProfit: toDecimalNumber(order.totalProfit),
    totalQuantity: order.totalQuantity,
    paymentMethod: order.paymentMethod,
    calcMode: order.calcMode,
    ...(note ? { note } : {}),
    date: toTimestampMs(order.date),
    createdAt: toTimestampMs(order.createdAt),
  };
}

export function mapSalesRecordItemResponse(
  item: SaleOrderWithItems['items'][number],
): SalesRecordItemResponseDto {
  return {
    productId:
      item.productId !== null ? String(item.productId) : `manual_${item.id}`,
    productName: item.productName,
    categoryName: item.categoryName,
    salePrice: toDecimalNumber(item.salePrice),
    profit: toDecimalNumber(item.profit),
    quantity: item.quantity,
  };
}

// ---------------------------------------------------------------------------
// 报表行聚合
// ---------------------------------------------------------------------------

function formatReportMonthDay(timestamp: number): string {
  const date = new Date(timestamp);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${month}/${day}`;
}

function getDayStart(timestamp: number): number {
  const d = new Date(timestamp);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function aggregateReportRows(
  orders: SaleOrderWithItems[],
): SalesDailyRowDto[] {
  const rows = new Map<string, SalesReportAggregationRow>();

  for (const order of orders) {
    const dayStart = getDayStart(order.date.getTime());
    const dateLabel = formatReportMonthDay(dayStart);

    for (const item of order.items) {
      const rowId = `${dayStart}-${item.productId ?? `manual_${item.productName}`}`;
      const revenue = sumMoney(
        [item],
        (currentItem) =>
          toDecimalNumber(currentItem.salePrice) * currentItem.quantity,
      );
      const existing = rows.get(rowId);
      if (existing) {
        existing.quantity += item.quantity;
        existing.revenue = Number((existing.revenue + revenue).toFixed(2));
        continue;
      }
      rows.set(rowId, {
        id: rowId,
        dateLabel,
        productName: item.productName,
        quantity: item.quantity,
        revenue,
      });
    }
  }

  return Array.from(rows.values()).sort((left, right) => {
    if (left.id === right.id) {
      return 0;
    }
    return left.id > right.id ? -1 : 1;
  });
}
