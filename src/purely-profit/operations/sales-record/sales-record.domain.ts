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
import {
  fenToYuan,
  pointsDeductAmountFen,
  toDiscountItems,
} from '../../../purely-club/scan-ordering/club-scan-ordering-order.mapper';
import type {
  SalesDailyRowDto,
  SalesRecordItemResponseDto,
  SalesRecordResponseDto,
  ScanOrderingAmountSummaryDto,
} from './dto/sales-record-response.dto';
import { SalesRecordAmountsDomain } from './sales-record-amounts.domain';
import {
  aggregateSalesRecordItems,
  buildVisibleSalesRecordRows,
  type AggregatedSalesRecordItem,
} from './sales-record-item-aggregation';

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
// 扫码点餐订单增强（销售记录展开区对齐 scan-ordering 详情）
// ---------------------------------------------------------------------------

/** 销售记录关联的扫码点餐订单最小查询形态（金额均为分）。 */
export interface ScanOrderingDetailSource {
  id: number;
  marketingSnapshot: unknown;
  itemOriginalAmount: number;
  specificationExtraAmount: number;
  payableAmount: number;
  items: Array<{
    productNameSnapshot: string;
    quantity: number;
    lineTotalAmount: number;
    payableLineAmount: number;
    specs: Array<{ specOptionNameSnapshot: string }>;
  }>;
}

/** 扫码点餐订单增强结果：规格行（与可见商品行一一对应）+ 原价单价（元）+ 金额汇总（元）。 */
export interface ScanOrderingEnrichment {
  specsRows: string[][];
  originalUnitPrices: number[];
  amountSummary: ScanOrderingAmountSummaryDto;
}

/**
 * 组装扫码点餐订单增强数据：
 * 1. 规格行与原价单价按 bridge 展开顺序与销售商品行一一对应（scanOrderItem 按数量展开为 unit）；
 * 2. 原价单价 = 未扣优惠的原价小计（lineTotalAmount）按数量分摊，余数补到最后一件，总和守恒；
 * 3. 金额汇总以分转元输出，总优惠额由后端计算，前端只读展示。
 */
export function buildScanOrderingEnrichment(
  order: SaleOrderWithItems,
  scan: ScanOrderingDetailSource,
): ScanOrderingEnrichment {
  const unitRows = buildScanOrderingUnitRows(scan.items);
  return {
    specsRows: buildSpecsRows(order.items, unitRows),
    originalUnitPrices: buildOriginalUnitPrices(order.items, unitRows),
    amountSummary: buildScanOrderingAmountSummary(scan),
  };
}

/** 扫码订单商品按数量展开的 unit 序列（规格 + 原价分摊单价，分）。 */
interface ScanOrderingUnit {
  specs: string[];
  originalUnitPriceFen: number;
}

/** 将扫码订单商品行按数量展开为 unit，原价小计分摊到每件（余数补到最后一件）。 */
function buildScanOrderingUnitRows(
  scanItems: ScanOrderingDetailSource['items'],
): ScanOrderingUnit[] {
  const units: ScanOrderingUnit[] = [];
  for (const item of scanItems) {
    const specs = (item.specs ?? []).map((spec) => spec.specOptionNameSnapshot);
    const quantity = Math.max(item.quantity, 0);
    const originalTotalFen = item.lineTotalAmount ?? 0;
    const unitPriceFen =
      quantity > 0 ? Math.floor(originalTotalFen / quantity) : 0;
    const remainder = quantity > 0 ? originalTotalFen % quantity : 0;
    for (let index = 0; index < quantity; index += 1) {
      units.push({
        specs,
        originalUnitPriceFen: unitPriceFen + (index < remainder ? 1 : 0),
      });
    }
  }
  return units;
}

/** 规格游标匹配：unit 序列与销售商品行一一对应，数量不一致时回退空规格。 */
function buildSpecsRows(
  saleItems: SaleOrderWithItems['items'],
  units: ScanOrderingUnit[],
): string[][] {
  if (units.length !== saleItems.length) {
    return saleItems.map(() => []);
  }
  return units.map((unit) => unit.specs);
}

/** 原价单价（分→元）：unit 序列与销售商品行一一对应，数量不一致时回退 0。 */
function buildOriginalUnitPrices(
  saleItems: SaleOrderWithItems['items'],
  units: ScanOrderingUnit[],
): number[] {
  if (units.length !== saleItems.length) {
    return saleItems.map(() => 0);
  }
  return units.map((unit) => fenToYuan(unit.originalUnitPriceFen));
}

/** 组装扫码点餐金额汇总（元）：优惠清单复用 club 营销快照解析，总优惠由后端计算。 */
function buildScanOrderingAmountSummary(
  scan: ScanOrderingDetailSource,
): ScanOrderingAmountSummaryDto {
  const itemOriginalAmount = fenToYuan(scan.itemOriginalAmount ?? 0);
  const specificationExtraAmount = fenToYuan(
    scan.specificationExtraAmount ?? 0,
  );
  const payableAmount = fenToYuan(scan.payableAmount ?? 0);
  // 优惠前总价 = 商品基础价 + 规格加价（分单位相加避免浮点误差），未扣任何优惠
  const totalBeforeDiscount = fenToYuan(
    (scan.itemOriginalAmount ?? 0) + (scan.specificationExtraAmount ?? 0),
  );
  const discountAmount = Math.max(
    itemOriginalAmount + specificationExtraAmount - payableAmount,
    0,
  );
  return {
    itemOriginalAmount,
    specificationExtraAmount,
    totalBeforeDiscount,
    payableAmount,
    discountAmount,
    pointsDeductAmount: fenToYuan(
      pointsDeductAmountFen(scan.marketingSnapshot),
    ),
    discountItems: toDiscountItems(scan.marketingSnapshot),
  };
}

// ---------------------------------------------------------------------------
// 响应映射
// ---------------------------------------------------------------------------

export function mapSalesRecordResponse(
  order: SaleOrderWithItems,
  enrichment?: ScanOrderingEnrichment,
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
    ...(enrichment ? { amountSummary: enrichment.amountSummary } : {}),
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
