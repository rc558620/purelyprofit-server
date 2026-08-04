import { Prisma, StaffRole } from '@prisma/client';
import {
  isDeductionProductName,
  toOptionalText,
  toTimestampMs,
} from '../../commerce/commerce.utils';
import { Money } from '../../../shared/money.utils';
import {
  formatShanghaiDayLabel,
  getShanghaiDayStartMs,
} from '../../../shared/shanghai-time.utils';
import {
  buildGrouponLabel,
  PAYMENT_METHOD_CONFIG,
} from '../handover/handover.constants';
import type {
  SalesDailyRowDto,
  SalesRecordItemResponseDto,
  SalesRecordResponseDto,
} from './dto/sales-record.dto';
import { SalesRecordAmountsDomain } from './sales-record-amounts.domain';

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
  select: {
    id: true;
    orderNo: true;
    note: true;
    paymentMethod: true;
    calcMode: true;
    operatorNameSnapshot: true;
    date: true;
    createdAt: true;
    refund: { select: { refundedAt: true } };
    // ─── 团购 / 券 / 平台结算元数据 ───────────────────────────
    customerPaymentMethod: true;
    grouponCode: true;
    grouponPlatform: true;
    settlementChannel: true;
    voucherCode: true;
    voucherPlatform: true;
    voucherFaceAmount: true;
    grouponSettlementStatus: true;
    grouponPlatformReceivable: true;
    grouponPlatformSettledAmount: true;
    grouponPlatformFee: true;
    items: {
      select: {
        id: true;
        productId: true;
        productName: true;
        categoryName: true;
        salePrice: true;
        profit: true;
        quantity: true;
      };
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
  const subAccountRole = staff.employeeProfile?.subAccounts?.role;
  if (subAccountRole === 'manager') return StaffRole.manager;
  return staff.role;
}

/**
 * 从 SaleOrder 提取团购元数据并转换为响应字段（分→元）。
 * 仅在有任意团购字段非空时返回对应字段，否则返回空对象。
 */
function buildGrouponResponseFields(order: SaleOrderWithItems): Partial<{
  customerPaymentMethod: string;
  grouponCode: string;
  grouponPlatform: string;
  settlementChannel: string;
  voucherCode: string;
  voucherPlatform: string;
  voucherFaceAmount: number;
  settlementStatus: string;
  platformReceivable: number;
  platformSettledAmount: number;
  platformFee: number;
}> {
  const result: Record<string, string | number> = {};
  if (order.customerPaymentMethod) {
    result.customerPaymentMethod = order.customerPaymentMethod;
  }
  if (order.grouponCode) result.grouponCode = order.grouponCode;
  if (order.grouponPlatform) result.grouponPlatform = order.grouponPlatform;
  if (order.settlementChannel) {
    result.settlementChannel = order.settlementChannel;
  }
  if (order.voucherCode) result.voucherCode = order.voucherCode;
  if (order.voucherPlatform) result.voucherPlatform = order.voucherPlatform;
  if (order.voucherFaceAmount != null) {
    result.voucherFaceAmount = Money.fromDbCents(
      order.voucherFaceAmount,
    ).toOutputYuan();
  }
  if (order.grouponSettlementStatus) {
    result.settlementStatus = order.grouponSettlementStatus;
  }
  if (order.grouponPlatformReceivable != null) {
    result.platformReceivable = Money.fromDbCents(
      order.grouponPlatformReceivable,
    ).toOutputYuan();
  }
  if (order.grouponPlatformSettledAmount != null) {
    result.platformSettledAmount = Money.fromDbCents(
      order.grouponPlatformSettledAmount,
    ).toOutputYuan();
  }
  if (order.grouponPlatformFee != null) {
    result.platformFee = Money.fromDbCents(
      order.grouponPlatformFee,
    ).toOutputYuan();
  }
  return result;
}

// ---------------------------------------------------------------------------
// 响应映射
// ---------------------------------------------------------------------------

export function mapSalesRecordResponse(
  order: SaleOrderWithItems,
): SalesRecordResponseDto {
  const note = toOptionalText(order.note);
  // 过滤掉抵扣行（预付款 + 续费抵扣），销售记录只展示实际消费
  const visibleItems = order.items.filter(
    (item) => !isDeductionProductName(item.productName),
  );

  // 构建 PreparedSalesItem 结构用于统一金额聚合
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

  // 使用统一金额聚合域计算权威金额（与 preview/create 保持一致）
  const amountsSnapshot =
    SalesRecordAmountsDomain.aggregateFromPreparedItems(preparedItems);

  const operatorName = toOptionalText(order.operatorNameSnapshot) ?? null;
  const operatorRole = resolveOperatorRole(order.operatorStaff);

  // ─── 团购 / 券 / 平台结算元数据（从分转元，可选）────────────────────────
  const grouponFields = buildGrouponResponseFields(order);

  // ─── 支付方式展示标签（团购场景拼接平台名称）──────────────────────────
  const isGrouponPayment =
    order.customerPaymentMethod === 'groupon_voucher' ||
    (order.paymentMethod as string) === 'groupon_voucher';
  const paymentLabel = isGrouponPayment
    ? buildGrouponLabel(order.grouponPlatform ?? order.voucherPlatform)
    : ((PAYMENT_METHOD_CONFIG as Record<string, { label: string }>)[
        order.paymentMethod
      ]?.label ?? order.paymentMethod);

  return {
    id: String(order.id),
    orderNo: order.orderNo,
    items: visibleItems.map((item, index) =>
      mapSalesRecordItemResponse(item, amountsSnapshot.items[index]),
    ),
    totalRevenue: amountsSnapshot.totalRevenue,
    totalProfit: amountsSnapshot.totalProfit,
    totalQuantity: amountsSnapshot.totalQuantity,
    paymentMethod: order.paymentMethod,
    paymentLabel,
    calcMode: order.calcMode,
    ...(note ? { note } : {}),
    ...(operatorName ? { operatorName } : {}),
    ...(operatorRole ? { operatorRole } : {}),
    date: toTimestampMs(order.date),
    createdAt: toTimestampMs(order.createdAt),
    refundedAt: order.refund ? toTimestampMs(order.refund.refundedAt) : null,
    ...grouponFields,
  };
}

export function mapSalesRecordItemResponse(
  item: SaleOrderWithItems['items'][number],
  amountItem?: ReturnType<
    typeof SalesRecordAmountsDomain.aggregateFromPreparedItems
  >['items'][0],
): SalesRecordItemResponseDto {
  return {
    productId:
      item.productId !== null ? String(item.productId) : `manual_${item.id}`,
    productName: item.productName,
    categoryName: item.categoryName,
    salePrice: Money.fromDbCents(item.salePrice).toOutputYuan(),
    profit: Money.fromDbCents(item.profit).toOutputYuan(),
    quantity: item.quantity,
    // 从权威金额快照补齐 subtotal 字段
    subtotal: amountItem?.subtotal ?? 0,
  };
}

// ---------------------------------------------------------------------------
// 报表行聚合
// ---------------------------------------------------------------------------

function formatReportMonthDay(timestamp: number): string {
  return formatShanghaiDayLabel(timestamp);
}

function getDayStart(timestamp: number): number {
  return getShanghaiDayStartMs(timestamp);
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
