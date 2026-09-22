// 销售记录域：订单查询形态 + 响应映射 + 台位费展示名拼接
// 增强数据（扫码点餐 / 空间会话规格）见 sales-record-enrichment；
// 报表行聚合见 sales-record-report-aggregation。
import { Prisma, StaffRole } from '@prisma/client';
import { toOptionalText, toTimestampMs } from '../../commerce/commerce.utils';
import { Money } from '../../../shared/money.utils';
import {
  buildGrouponLabel,
  PAYMENT_METHOD_CONFIG,
} from '../handover/handover.constants';
import type {
  SalesRecordItemResponseDto,
  SalesRecordResponseDto,
} from './dto/sales-record-response.dto';
import { SalesRecordAmountsDomain } from './sales-record-amounts.domain';
import {
  aggregateSalesRecordItems,
  buildVisibleSalesRecordRows,
  type AggregatedSalesRecordItem,
  type SalesRecordSpecsEnrichment,
} from './sales-record-item-aggregation';
import type { ScanOrderingEnrichment } from './sales-record-enrichment';

// ---------------------------------------------------------------------------
// 订单查询形态
// ---------------------------------------------------------------------------

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
    scanOrderId: true;
    // ─── 手工补录（录入订单）元数据 ───────────────────────
    manualEntry: true;
    diningMode: true;
    sourceChannel: true;
    guestCount: true;
    externalOrderNo: true;
    customerPhone: true;
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

// ---------------------------------------------------------------------------
// 响应映射
// ---------------------------------------------------------------------------

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

export function mapSalesRecordResponse(
  order: SaleOrderWithItems,
  enrichment?: ScanOrderingEnrichment | SalesRecordSpecsEnrichment,
): SalesRecordResponseDto {
  const note = toOptionalText(order.note);
  // 构建可见明细行：规格/原价按原始索引对齐，并过滤抵扣行（预付款 + 续费抵扣）
  const visibleRows = buildVisibleSalesRecordRows(order, enrichment);

  // 构建 PreparedSalesItem 结构用于统一金额聚合
  const preparedItems = visibleRows.map(({ item }) => ({
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

  // 按「商品 ID + 商品名称 + 规格」叠加相同商品行（数量/小计合并，单价加权平均）
  const aggregatedItems = aggregateSalesRecordItems(
    visibleRows,
    amountsSnapshot.items,
  );

  const operatorName = toOptionalText(order.operatorNameSnapshot) ?? null;
  const operatorRole = resolveOperatorRole(order.operatorStaff);

  // ─── 团购 / 券 / 平台结算元数据（从分转元，可选）────────────────────────
  const grouponFields = buildGrouponResponseFields(order);

  // ─── 支付方式展示标签（团购场景拼接平台名称）──────────────────────────
  const isGrouponPayment =
    order.customerPaymentMethod === 'groupon_voucher' ||
    (order.paymentMethod as string) === 'groupon_voucher';
  // 扫码点餐余额支付（other）统一展示为 balance（余额）；仅扫码订单生效，普通订单原样
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

  return {
    id: String(order.id),
    orderNo: order.orderNo,
    items: aggregatedItems.map((aggregated) =>
      mapSalesRecordItemResponse(
        aggregated,
        order.spaceSession?.space?.name ?? null,
      ),
    ),
    totalRevenue: amountsSnapshot.totalRevenue,
    totalProfit: amountsSnapshot.totalProfit,
    totalQuantity: amountsSnapshot.totalQuantity,
    paymentMethod,
    paymentLabel,
    calcMode: order.calcMode,
    ...(note ? { note } : {}),
    ...(operatorName ? { operatorName } : {}),
    ...(operatorRole ? { operatorRole } : {}),
    ...(order.manualEntry
      ? {
          manualEntry: true,
          diningMode: order.diningMode ?? undefined,
          sourceChannel: order.sourceChannel ?? undefined,
          guestCount: order.guestCount ?? null,
          externalOrderNo: order.externalOrderNo ?? undefined,
          customerPhone: order.customerPhone ?? undefined,
        }
      : {}),
    date: toTimestampMs(order.date),
    createdAt: toTimestampMs(order.createdAt),
    refundedAt: order.refund ? toTimestampMs(order.refund.refundedAt) : null,
    ...grouponFields,
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

// ---------------------------------------------------------------------------
// 台位费展示名（列表 / 报表 / CSV 共用）
// ---------------------------------------------------------------------------

/**
 * 台位费行命名：兼容「台位费（固定）/ 台位费（按单价）」与
 * 「台位费 2小时30分钟」（计时模式已去掉括号）两种形式。
 */
const TABLE_FEE_NAME_RE = /^台位费(（|\s|$)/;

function shouldPrefixReportSpaceName(productName: string): boolean {
  return TABLE_FEE_NAME_RE.test(productName);
}

/**
 * 台位费商品拼接空间名称前缀（空格分隔）：列表、报表、CSV 共用的唯一拼接来源。
 * 非台位费商品或缺失空间名时原样返回。
 */
export function prefixSpaceName(
  spaceName: string | null | undefined,
  productName: string,
): string {
  if (!spaceName || !shouldPrefixReportSpaceName(productName)) {
    return productName;
  }
  return `${spaceName} ${productName}`;
}

/** 台位费商品展示名：从订单空间会话取空间名并拼接前缀（报表/CSV 复用）。 */
export function resolveReportProductName(
  order: SaleOrderWithItems,
  item: SaleOrderWithItems['items'][number],
): string {
  return prefixSpaceName(
    toOptionalText(order.spaceSession?.space?.name),
    item.productName,
  );
}
