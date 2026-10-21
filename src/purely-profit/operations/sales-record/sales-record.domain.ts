// 销售记录域：订单查询形态 + 响应映射 + 台位费展示名拼接
// 增强数据（扫码点餐 / 空间会话规格）见 sales-record-enrichment；
// 报表行聚合见 sales-record-report-aggregation。
import { Prisma, StaffRole } from '@prisma/client';
import {
  isAmountDeductionSalesRecordRow,
  isNonQuantitySalesRecordRow,
  SELF_ORDER_DEDUCTION_PRODUCT_NAME,
  toOptionalText,
  toTimestampMs,
  TABLE_FEE_NAME_RE,
} from '../../commerce/commerce.utils';
import { Money } from '../../../shared/money.utils';
import {
  buildGrouponLabel,
  PAYMENT_METHOD_CONFIG,
} from '../handover/handover.constants';
import type {
  SalesRecordItemResponseDto,
  SalesRecordResponseDto,
} from './dto/sales-record-response.dto';
import {
  SalesRecordAmountsDomain,
  type SalesRecordAmountsSnapshot,
} from './sales-record-amounts.domain';
import type { PreparedSalesItem } from './sales-record-item-preparation.service';
import {
  aggregateSalesRecordItems,
  buildVisibleSalesRecordRows,
  type AggregatedSalesRecordItem,
  type SalesRecordItemRow,
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
        // 券程可抵台位费（分）：券预设的 1 小时台位费 / 固定价
        hourlyRate: true;
        space: {
          select: {
            name: true;
          };
        };
        // 续费记录：按支付方式拆分「实付金额」的收款来源
        sessionRenewRecords: {
          select: {
            amount: true;
            paymentMethod: true;
            voucherFaceAmount: true;
          };
          orderBy: [{ id: 'asc' }];
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

/** 订单级金额：营业额 / 利润 / 件数 / 顾客实付 */
export interface SalesRecordOrderAmounts {
  /** 营业额（元） */
  totalRevenue: number;
  /** 利润（元） */
  totalProfit: number;
  /** 销售件数 */
  totalQuantity: number;
  /** 顾客实付金额（元） */
  payableAmount: number;
  /** 团购券结算单的消费构成（券抵 + 超时 + 点单）；非团购券单为 null */
  grouponVoucherBreakdown: GrouponVoucherBreakdown | null;
}

/**
 * 自助下单「已在线支付商品」的正向行：与「XX · 自助下单抵扣」行成对出现。
 *
 * 该笔消费已在小程序侧单独生成销售单（createForPaidOrder），本单不能再计一次营业额，
 * 因此这对行在金额上必须同时排除（正向行 +N 与抵扣行 −N 相加为 0）；
 * 只排除一侧都会造成重复计算（详见 listVisibleSaleOrderItems 注释）。
 * ⚠️ 件数仍按真实销量计入（正向行算 1 件），仅金额排除。
 */
function buildSelfOrderPairedNames(rows: SalesRecordItemRow[]): Set<string> {
  const suffix = ` · ${SELF_ORDER_DEDUCTION_PRODUCT_NAME}`;
  return new Set(
    rows
      .filter(({ item }) => item.productName.endsWith(suffix))
      .map(({ item }) => item.productName.slice(0, -suffix.length)),
  );
}

/**
 * 判断商品行是否为某条自助下单抵扣行的配对正向行。
 * 规格行带「（规格）」后缀，抵扣行名称已剥离规格，故按「同名 + 括号后缀」匹配。
 */
function isSelfOrderPairedRow(
  productName: string,
  pairedNames: Set<string>,
): boolean {
  if (pairedNames.size === 0) return false;
  if (pairedNames.has(productName)) return true;
  const bracketIndex = productName.indexOf('（');
  return (
    bracketIndex > 0 && pairedNames.has(productName.slice(0, bracketIndex))
  );
}

/** 可见行 → 金额聚合入参（件数与金额分开判定） */
function buildAmountsPreparedItems(
  rows: SalesRecordItemRow[],
): PreparedSalesItem[] {
  const selfOrderPairedNames = buildSelfOrderPairedNames(rows);
  return rows.map(({ item }) => ({
    productId: item.productId,
    productName: item.productName,
    categoryName: item.categoryName,
    salePrice: Money.fromDbCents(item.salePrice),
    profit: Money.fromDbCents(item.profit),
    quantity: item.quantity,
    // 抵扣行与台位费行不计入销售件数，否则会把金额冲减行 / 计时行
    // 当成一件商品，导致销量统计虚高（与空间结账 totalQuantity 同口径）
    countsTowardTotalQuantity: !isNonQuantitySalesRecordRow(item.productName),
    // 金额口径独立判定：
    // - 台位费（计时/一口价）必须计入——它是真实营收，若沿用件数口径，
    //   纯台位费订单的营业额 / 利润会被算成 0；
    // - 抵扣行（预付款/续费/自助下单抵扣）不计入；
    // - 与自助下单抵扣行配对的正向商品行同样不计入（已在线支付，净差为 0）。
    countsTowardAmounts:
      !isAmountDeductionSalesRecordRow(item.productName) &&
      !isSelfOrderPairedRow(item.productName, selfOrderPairedNames),
    image: undefined as string | undefined,
  }));
}

/**
 * 是否为「团购券结算」的空间订单：顾客用平台券支付（非扫码订单）且券面金额有效。
 *
 * 这类订单的券面金额 = 顾客买券实付 = 门店券结算收入，
 * 金额口径见 SalesRecordAmountsDomain.resolveGrouponVoucherAmounts。
 */
export function isGrouponVoucherSettledOrder(
  order: SaleOrderWithItems,
): boolean {
  // 扫码点餐 / 手工补录订单走 amountSummary，不适用券程台位费口径
  if (order.scanOrderId !== null) return false;
  const isGrouponPayment =
    order.customerPaymentMethod === 'groupon_voucher' ||
    (order.paymentMethod as string) === 'groupon_voucher';
  return (
    isGrouponPayment &&
    order.voucherFaceAmount != null &&
    order.voucherFaceAmount > 0
  );
}

/**
 * 团购券结算单的「消费构成」拆分：券实际抵扣 + 超时台位费 + 点单。
 * 券只按它实际抵消的台位费计（券面大于消费时按消费计），
 * 多付的券面在结账时退回顾客（产品口径：超额部分按退款处理），不计入本单营业额。
 */
export interface GrouponVoucherBreakdown {
  /** 券实际抵扣的台位费金额（元）= min(台位费, 券程, 券面)，仅用于营业额计算 */
  voucherCoveredRevenue: number;
  /** 券面金额（元）——收款明细的「券抵台位费」段按券面全额记 */
  voucherFaceRevenue: number;
  /** 超时台位费（元，顾客到店另付） */
  overtimeRevenue: number;
  /** 点单金额（元） */
  itemsRevenue: number;
}

/**
 * 解析订单级金额（列表 / 报表 / CSV 唯一口径）。
 *
 * 团购券空间订单：券程台位费按券实际抵扣计收（min(台位费, 券程, 券面)），
 * 超时台位费由顾客到店另付，点单全额计入；其余订单沿用商品行聚合结果。
 */
export function resolveSalesRecordAmounts(
  order: SaleOrderWithItems,
  visibleRows: SalesRecordItemRow[],
  amountsSnapshot: SalesRecordAmountsSnapshot,
): SalesRecordOrderAmounts {
  let totalRevenue = amountsSnapshot.totalRevenue;
  let totalProfit = amountsSnapshot.totalProfit;
  let grouponVoucherBreakdown: GrouponVoucherBreakdown | null = null;

  if (isGrouponVoucherSettledOrder(order)) {
    let tableFeeRevenue = Money.zero();
    let tableFeeProfit = Money.zero();
    visibleRows.forEach(({ item }, index) => {
      if (!TABLE_FEE_NAME_RE.test(item.productName)) return;
      tableFeeRevenue = tableFeeRevenue.add(
        Money.fromInputYuan(amountsSnapshot.items[index].subtotal),
      );
      tableFeeProfit = tableFeeProfit.add(
        Money.fromInputYuan(amountsSnapshot.items[index].profitSubtotal),
      );
    });
    // 无台位费行的券单（纯点单用券）不适用券面替换，保持商品行口径
    if (tableFeeRevenue.isPositive()) {
      const itemsRevenue = Money.fromInputYuan(amountsSnapshot.totalRevenue)
        .subtract(tableFeeRevenue)
        .toOutputYuan();
      const adjusted = SalesRecordAmountsDomain.resolveGrouponVoucherAmounts({
        voucherFaceAmount: Money.fromDbCents(
          order.voucherFaceAmount!,
        ).toOutputYuan(),
        tableFeeRevenue: tableFeeRevenue.toOutputYuan(),
        otherRevenue: itemsRevenue,
        otherProfit: Money.fromInputYuan(amountsSnapshot.totalProfit)
          .subtract(tableFeeProfit)
          .toOutputYuan(),
        // 券程可抵台位费 = 券预设的 1 小时台位费 / 固定价；缺失时视为券全包
        entitledTableFee:
          order.spaceSession?.hourlyRate == null
            ? null
            : Money.fromDbCents(order.spaceSession.hourlyRate).toOutputYuan(),
      });
      totalRevenue = adjusted.totalRevenue;
      totalProfit = adjusted.totalProfit;
      grouponVoucherBreakdown = {
        voucherCoveredRevenue: adjusted.voucherCoveredRevenue,
        // 收款明细的券抵段按券面全额记（不按台位费分钟数折算）
        voucherFaceRevenue: Money.fromDbCents(
          order.voucherFaceAmount!,
        ).toOutputYuan(),
        overtimeRevenue: adjusted.overtimeRevenue,
        itemsRevenue,
      };
    }
  }

  // 实付金额 = 本单营业额（营业额与实付同口径）：
  // - 团购券订单：券实际抵扣 + 超时台位费 + 点单；
  // - 其余订单：本次消费额。预付/续费抵扣只是分次收款（钱已真实收到，不减），
  //   抵扣超过消费时（如续费券 ¥35.2 本次只消费 ¥1.64）多余部分在结账时退回顾客
  //   （产品口径：超额按退款处理，见 buildSalesRecordPaymentEvents 的 checkout_refund），
  //   营业额仍按本次消费额记，既不出现负数也不凭空放大；
  // - 已退款订单归零（与卡片 +¥0 口径一致）。
  const payableAmount = order.refund?.refundedAt
    ? 0
    : Math.max(0, totalRevenue);

  return {
    totalRevenue,
    totalProfit,
    totalQuantity: amountsSnapshot.totalQuantity,
    payableAmount,
    grouponVoucherBreakdown,
  };
}

/**
 * 实付金额的「收款 / 退款事件」明细：每笔钱都带真实支付方式，
 * 少了用结账选择的方式补钱、多了用结账选择的方式退款。
 *
 * ⚠️ 产品口径（2026-10-21 确认）：抵扣超过消费时，超额部分一律按**退款**处理，
 * 不存在「转余额 / 留券余额」。营业额侧仍只记本次消费额，差额由退款事件表达。
 *
 * 恒等式：Σ(收款) − Σ(退款) = 实付金额，前端逐行展示，合计恒等。
 */
export interface SalesRecordPaymentEvent {
  /**
   * 事件类型：
   * - 团购券结算单：voucher_table_fee 券抵台位费 + checkout_due 结账（到店补付）
   * - 其余订单（资金流口径）：open_voucher 开台券 / renew 续费 / checkout_due 结账补差 / checkout_refund 结账退款
   */
  kind:
    | 'open_voucher'
    | 'renew'
    | 'checkout_due'
    | 'checkout_refund'
    | 'voucher_table_fee';
  /** 支付方式（与订单 paymentMethod 同域，供前端配色 / 文案） */
  method: string;
  /** 团购平台（仅 open_voucher / voucher_table_fee，如 chunlibao） */
  platform?: string;
  /** 金额（元，正数） */
  amount: number;
  /** 方向：in=收款 / out=退款 */
  direction: 'in' | 'out';
}

export function buildSalesRecordPaymentEvents(
  order: SaleOrderWithItems,
  payableAmount: number,
  grouponVoucherBreakdown?: GrouponVoucherBreakdown | null,
): SalesRecordPaymentEvent[] {
  // 已退款订单不拆收款来源（实付为 0）
  if (order.refund?.refundedAt) return [];

  const checkoutMethod = String(
    order.customerPaymentMethod ?? order.paymentMethod ?? 'cash',
  );

  // ① 团购券结算单：券抵 + 结账两段——
  //    「券抵台位费」= 券面金额（顾客买券付的钱，按券面全额记，不按台位费实际分钟数折算）；
  //    差额按结账方式收或退：券面 < 实付 → 结账补付；券面 > 实付 → 结账退款
  //    （产品口径：超额部分一律按退款处理，不存在「转余额」）。
  if (grouponVoucherBreakdown) {
    const voucherEvents: SalesRecordPaymentEvent[] = [];
    const voucherPart = Money.fromInputYuan(
      grouponVoucherBreakdown.voucherFaceRevenue,
    );
    if (voucherPart.isPositive()) {
      voucherEvents.push({
        kind: 'voucher_table_fee',
        method: 'groupon_voucher',
        ...((order.voucherPlatform ?? order.grouponPlatform)
          ? { platform: order.voucherPlatform ?? order.grouponPlatform! }
          : {}),
        amount: voucherPart.toOutputYuan(),
        direction: 'in',
      });
    }
    const delta = Money.fromInputYuan(payableAmount).subtract(voucherPart);
    const deltaCents = Math.round(delta.toOutputYuan() * 100);
    if (deltaCents > 0) {
      voucherEvents.push({
        kind: 'checkout_due',
        method: checkoutMethod,
        amount: delta.toOutputYuan(),
        direction: 'in',
      });
    } else if (deltaCents < 0) {
      voucherEvents.push({
        kind: 'checkout_refund',
        method: checkoutMethod,
        amount: Money.fromDbCents(-deltaCents).toOutputYuan(),
        direction: 'out',
      });
    }
    return voucherEvents;
  }

  const events: SalesRecordPaymentEvent[] = [];
  let collected = Money.zero();

  // ① 开台券：券面金额（开台时已收款）
  const faceAmount =
    order.voucherFaceAmount == null
      ? Money.zero()
      : Money.fromDbCents(order.voucherFaceAmount);
  if (faceAmount.isPositive()) {
    events.push({
      kind: 'open_voucher',
      method: 'groupon_voucher',
      ...((order.voucherPlatform ?? order.grouponPlatform)
        ? { platform: order.voucherPlatform ?? order.grouponPlatform! }
        : {}),
      amount: faceAmount.toOutputYuan(),
      direction: 'in',
    });
    collected = collected.add(faceAmount);
  }

  // ② 续费：按支付方式合并（多条续费方式不同时前端分多行展示）
  const renewByMethod = new Map<string, Money>();
  for (const record of order.spaceSession?.sessionRenewRecords ?? []) {
    const method = String(record.paymentMethod ?? 'cash');
    const amount = Money.fromDbCents(record.amount);
    if (!amount.isPositive()) continue;
    renewByMethod.set(
      method,
      (renewByMethod.get(method) ?? Money.zero()).add(amount),
    );
    collected = collected.add(amount);
  }
  for (const [method, amount] of renewByMethod) {
    events.push({
      kind: 'renew',
      method,
      amount: amount.toOutputYuan(),
      direction: 'in',
    });
  }

  // ③ 结账补差 / ④ 结账退款：差额按结账选择的支付方式收或退
  const delta = Money.fromInputYuan(payableAmount).subtract(collected);
  const deltaCents = Math.round(delta.toOutputYuan() * 100);
  if (deltaCents > 0) {
    events.push({
      kind: 'checkout_due',
      method: checkoutMethod,
      amount: delta.toOutputYuan(),
      direction: 'in',
    });
  } else if (deltaCents < 0) {
    events.push({
      kind: 'checkout_refund',
      method: checkoutMethod,
      amount: Money.fromDbCents(-deltaCents).toOutputYuan(),
      direction: 'out',
    });
  }

  return events;
}

/** 便于 CSV / 报表调用：内部构建可见行并完成金额聚合。 */
export function resolveSalesRecordAmountsFromOrder(
  order: SaleOrderWithItems,
): SalesRecordOrderAmounts {
  const visibleRows = buildVisibleSalesRecordRows(order);
  const amountsSnapshot = SalesRecordAmountsDomain.aggregateFromPreparedItems(
    buildAmountsPreparedItems(visibleRows),
  );
  return resolveSalesRecordAmounts(order, visibleRows, amountsSnapshot);
}

export function mapSalesRecordResponse(
  order: SaleOrderWithItems,
  enrichment?: ScanOrderingEnrichment | SalesRecordSpecsEnrichment,
): SalesRecordResponseDto {
  const note = toOptionalText(order.note);
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
