// 销售记录响应映射：订单 → 列表 / 详情响应 DTO（含操作员角色、团购元数据、支付方式展示）。
// 金额口径见 sales-record.domain；收款事件见 sales-record-payment-events.domain；
// 台位费展示名见 sales-record-display-name.utils。
import { StaffRole } from '@prisma/client';
import {
  toOptionalText,
  toOptionalTimestampMs,
  toTimestampMs,
} from '../../commerce/commerce.utils';
import { Money } from '../../../shared/money.utils';
import {
  buildGrouponLabel,
  PAYMENT_METHOD_CONFIG,
} from '../handover/handover.constants';
import type {
  SalesRecordItemResponseDto,
  SalesRecordPaymentMethodValue,
  SalesRecordResponseDto,
} from './dto/sales-record-response.dto';
import { SalesRecordAmountsDomain } from './sales-record-amounts.domain';
import {
  prefixSpaceName,
  resolveOperatorDisplayName,
} from './sales-record-display-name.utils';
import type { ScanOrderingEnrichment } from './sales-record-enrichment';
import {
  aggregateSalesRecordItems,
  buildVisibleSalesRecordRows,
  type AggregatedSalesRecordItem,
  type SalesRecordSpecsEnrichment,
} from './sales-record-item-aggregation';
import {
  buildAmountsPreparedItems,
  resolveSalesRecordAmounts,
  type SaleOrderWithItems,
  type SalesRecordOrderAmounts,
} from './sales-record.domain';
import {
  buildSalesRecordPaymentEvents,
  isVoucherPrepaidOrder,
  type SalesRecordPaymentEvent,
} from './sales-record-payment-events.domain';

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
  // 券面金额只在确属团购券预付时下发：历史脏数据里现金预付的实收金额
  // 曾被写进该字段，原样透出会让卡片多显示「券面金额」并误导成券结算
  if (order.voucherFaceAmount != null && isVoucherPrepaidOrder(order)) {
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

/** 手工补录（录入订单）元数据；非录入订单不输出这些字段 */
function buildManualEntryFields(
  order: SaleOrderWithItems,
): Partial<SalesRecordResponseDto> {
  if (!order.manualEntry) return {};
  return {
    manualEntry: true,
    diningMode: order.diningMode ?? undefined,
    sourceChannel: order.sourceChannel ?? undefined,
    guestCount: order.guestCount ?? null,
    externalOrderNo: order.externalOrderNo ?? undefined,
    customerPhone: order.customerPhone ?? undefined,
  };
}

/**
 * 支付方式展示：团购场景拼接平台名称；扫码点餐余额支付（other）统一展示为
 * balance（余额），仅扫码订单生效，普通订单原样。
 */
function resolvePaymentDisplay(order: SaleOrderWithItems): {
  paymentMethod: SalesRecordPaymentMethodValue;
  paymentLabel: string;
} {
  const isGrouponPayment =
    order.customerPaymentMethod === 'groupon_voucher' ||
    (order.paymentMethod as string) === 'groupon_voucher';
  const isScanOrderingBalance =
    order.scanOrderId !== null && order.paymentMethod === 'other';
  const paymentMethod = isScanOrderingBalance ? 'balance' : order.paymentMethod;
  const paymentLabel = isGrouponPayment
    ? buildGrouponLabel(order.grouponPlatform ?? order.voucherPlatform)
    : isScanOrderingBalance
      ? '余额'
      : ((PAYMENT_METHOD_CONFIG as Record<string, { label: string }>)[
          order.paymentMethod
        ]?.label ?? order.paymentMethod);
  return { paymentMethod, paymentLabel };
}

/** 响应所需的权威数据：金额、收款事件、聚合明细行 */
interface SalesRecordResponseBasis {
  orderAmounts: SalesRecordOrderAmounts;
  paymentEvents: SalesRecordPaymentEvent[];
  aggregatedItems: AggregatedSalesRecordItem[];
}

/** 计算响应权威数据：可见行 → 金额聚合 → 订单级金额 → 收款事件 → 明细行聚合 */
function resolveResponseBasis(
  order: SaleOrderWithItems,
  enrichment?: ScanOrderingEnrichment | SalesRecordSpecsEnrichment,
): SalesRecordResponseBasis {
  // 构建可见明细行：规格/原价按原始索引对齐，并过滤抵扣行（预付款 + 续费抵扣）
  const visibleRows = buildVisibleSalesRecordRows(order, enrichment);
  // 使用统一金额聚合域计算权威金额（与 preview/create 保持一致）
  const amountsSnapshot = SalesRecordAmountsDomain.aggregateFromPreparedItems(
    buildAmountsPreparedItems(visibleRows),
  );
  // 订单级金额（含团购券口径调整与实付金额）
  const orderAmounts = resolveSalesRecordAmounts(
    order,
    visibleRows,
    amountsSnapshot,
  );
  // 收款 / 退款事件明细（实付金额的来源构成）
  const paymentEvents = buildSalesRecordPaymentEvents(
    order,
    orderAmounts.payableAmount,
    orderAmounts.grouponVoucherBreakdown,
  );
  // 按「商品 ID + 商品名称 + 规格」叠加相同商品行（数量/小计合并，单价加权平均）
  const aggregatedItems = aggregateSalesRecordItems(
    visibleRows,
    amountsSnapshot.items,
  );
  return { orderAmounts, paymentEvents, aggregatedItems };
}

/**
 * 是否为「空间结账单」：真实关联到同门店、已结账的空间会话，且订单未退款。
 *
 * 只作为列表来源标记（决定是否展示补打入口），不承载小票内容；
 * 真正的补打接口会在服务层重新校验一次，不信任该标记。
 */
export function resolveIsSpaceCheckoutOrder(
  order: Pick<SaleOrderWithItems, 'storeId' | 'refund' | 'spaceSession'>,
): boolean {
  const session = order.spaceSession;
  if (!session) return false;
  if (session.status !== 'settled') return false;
  if (order.refund) return false;
  return session.storeId === order.storeId;
}

/**
 * 开台信息：仅关联空间会话的订单返回「开台时间 + 开台操作员」。
 *
 * 结账侧不重复输出字段——空间结账落单时 `date` 即结账时刻、
 * `operatorName` 即结账操作员，前端直接用这两个既有字段展示「结账」。
 * 无会话（扫码点餐 / 手工补录 / 普通录单）时一律缺省，前端保留原单时间展示。
 */
function buildSpaceSessionOpenFields(
  order: SaleOrderWithItems,
): Partial<SalesRecordResponseDto> {
  const session = order.spaceSession;
  if (!session) return {};
  const openTime = toOptionalTimestampMs(session.startTime);
  const openOperatorName = toOptionalText(session.openOperatorNameSnapshot);
  const openOperatorRole = resolveOperatorRole(session.openOperatorStaff);
  return {
    ...(openTime === undefined ? {} : { openTime }),
    ...(openOperatorName ? { openOperatorName } : {}),
    ...(openOperatorRole ? { openOperatorRole } : {}),
  };
}

export function mapSalesRecordResponse(
  order: SaleOrderWithItems,
  enrichment?: ScanOrderingEnrichment | SalesRecordSpecsEnrichment,
): SalesRecordResponseDto {
  const note = toOptionalText(order.note);
  const { orderAmounts, paymentEvents, aggregatedItems } = resolveResponseBasis(
    order,
    enrichment,
  );

  // 结账操作员：自动结账会话由系统用户落单，兜底展示「空间自动结账」
  const operatorName = resolveOperatorDisplayName(order) ?? null;
  const operatorRole = resolveOperatorRole(order.operatorStaff);
  const { paymentMethod, paymentLabel } = resolvePaymentDisplay(order);

  return {
    id: String(order.id),
    orderNo: order.orderNo,
    items: aggregatedItems.map((aggregated) =>
      mapSalesRecordItemResponse(
        aggregated,
        order.spaceSession?.space?.name ?? null,
      ),
    ),
    totalRevenue: orderAmounts.totalRevenue,
    totalProfit: orderAmounts.totalProfit,
    totalQuantity: orderAmounts.totalQuantity,
    payableAmount: orderAmounts.payableAmount,
    paymentEvents,
    paymentMethod,
    paymentLabel,
    calcMode: order.calcMode,
    ...(note ? { note } : {}),
    ...(operatorName ? { operatorName } : {}),
    ...(operatorRole ? { operatorRole } : {}),
    ...buildSpaceSessionOpenFields(order),
    ...buildManualEntryFields(order),
    date: toTimestampMs(order.date),
    createdAt: toTimestampMs(order.createdAt),
    refundedAt: order.refund ? toTimestampMs(order.refund.refundedAt) : null,
    // 来源标记：供「空间小票补打」入口判断，前端不得从订单号/商品名/备注反猜
    isSpaceCheckoutOrder: resolveIsSpaceCheckoutOrder(order),
    // ─── 团购 / 券 / 平台结算元数据（从分转元，可选）────────────────────────
    ...buildGrouponResponseFields(order),
    // 金额汇总仅扫码点餐增强提供；非扫码订单（空间会话）只有规格行，不得输出该字段
    ...(enrichment && 'amountSummary' in enrichment
      ? { amountSummary: enrichment.amountSummary }
      : {}),
  };
}

export function mapSalesRecordItemResponse(
  aggregated: AggregatedSalesRecordItem,
  spaceName?: string | null,
): SalesRecordItemResponseDto {
  // 空间台位费商品（非餐饮场景）带空间名称前缀（空格分隔），与报表/CSV 口径一致
  const displayName = prefixSpaceName(spaceName, aggregated.productName);
  return {
    productId: aggregated.productId,
    productName: displayName,
    categoryName: aggregated.categoryName,
    salePrice: aggregated.salePrice,
    profit: aggregated.profit,
    quantity: aggregated.quantity,
    // 聚合行小计由后端叠加计算，前端只读展示
    subtotal: aggregated.subtotal,
    // 扫码点餐订单规格快照；空数组不返回，前端缺省回退 []
    ...(aggregated.specs && aggregated.specs.length > 0
      ? { specs: aggregated.specs }
      : {}),
    // 扫码点餐订单优惠前单价（元）；原价为 0 时不返回，前端回退 salePrice
    ...(aggregated.originalUnitPrice !== undefined &&
    aggregated.originalUnitPrice > 0
      ? { originalUnitPrice: aggregated.originalUnitPrice }
      : {}),
  };
}
