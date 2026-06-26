import { BadRequestException } from '@nestjs/common';
import { Prisma, StaffRole } from '@prisma/client';
import Decimal from 'decimal.js';
import {
  isDeductionProductName,
  toDecimalNumber,
  toOptionalText,
  toTimestampMs,
} from '../../commerce/commerce.utils';
import type {
  SalesDailyRowDto,
  SalesRecordItemResponseDto,
  SalesRecordResponseDto,
} from './dto/sales-record.dto';
import { isSameMoney } from './sales-record.utils';

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
    spaceSession: {
      select: {
        space: {
          select: {
            name: true;
          };
        };
      };
    };
    operatorStaff: {
      select: {
        role: true;
        employeeProfile: {
          select: {
            subAccounts: {
              select: { role: true };
              take: 1;
            };
          };
        };
      };
    };
  };
}>;

/**
 * 解析操作员的真实角色（与交班管理保持一致的逻辑）：
 * 优先使用 Staff.role（OWNER 直接可信），
 * 否则检查关联的 StoreSubAccount.role（manager → MANAGER）。
 */
function resolveOperatorRole(
  staff: SaleOrderWithItems['operatorStaff'],
): StaffRole | null {
  if (!staff) return null;
  if (staff.role === StaffRole.owner) return StaffRole.owner;
  const subAccountRole = staff.employeeProfile?.subAccounts[0]?.role;
  if (subAccountRole === 'manager') return StaffRole.manager;
  return staff.role;
}

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
  // 过滤掉抵扣行（预付抵扣 + 续费抵扣），销售记录只展示实际消费
  const visibleItems = order.items.filter(
    (item) => !isDeductionProductName(item.productName),
  );
  // 重算不含抵扣行的 totalRevenue、totalProfit 和 totalQuantity
  const totalRevenue = visibleItems.reduce(
    (sum, item) => sum + toDecimalNumber(item.salePrice) * item.quantity,
    0,
  );
  const totalProfit = visibleItems.reduce(
    (sum, item) => sum + toDecimalNumber(item.profit) * item.quantity,
    0,
  );
  const totalQuantity = visibleItems.reduce(
    (sum, item) => sum + item.quantity,
    0,
  );

  const operatorName = toOptionalText(order.operatorNameSnapshot) ?? null;
  const operatorRole = resolveOperatorRole(order.operatorStaff);

  return {
    id: String(order.id),
    orderNo: order.orderNo,
    items: visibleItems.map((item) => mapSalesRecordItemResponse(item)),
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    totalProfit: Math.round(totalProfit * 100) / 100,
    totalQuantity,
    paymentMethod: order.paymentMethod,
    calcMode: order.calcMode,
    ...(note ? { note } : {}),
    ...(operatorName ? { operatorName } : {}),
    ...(operatorRole ? { operatorRole } : {}),
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

function shouldPrefixReportSpaceName(productName: string): boolean {
  return productName.startsWith('台位费（');
}

function resolveReportProductName(
  order: SaleOrderWithItems,
  item: SaleOrderWithItems['items'][number],
): string {
  const spaceName = toOptionalText(order.spaceSession?.space?.name);
  if (!spaceName || !shouldPrefixReportSpaceName(item.productName)) {
    return item.productName;
  }

  return `${spaceName}${item.productName}`;
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
      // 排除抵扣行（预付抵扣 + 续费抵扣），报表只展示实际消费
      if (isDeductionProductName(item.productName)) {
        continue;
      }

      const productName = resolveReportProductName(order, item);
      const rowId = buildReportRowId(dayStart, order, item);
      const revenue = new Decimal(toDecimalNumber(item.salePrice))
        .mul(item.quantity)
        .toDecimalPlaces(2)
        .toNumber();
      const existing = rows.get(rowId);
      if (existing) {
        existing.quantity += item.quantity;
        existing.revenue = new Decimal(existing.revenue)
          .add(revenue)
          .toDecimalPlaces(2)
          .toNumber();
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
