// 销售记录域：订单查询形态 + 订单级金额口径（列表 / 报表 / CSV 唯一口径）。
// 收款 / 退款事件见 sales-record-payment-events.domain；
// 响应映射见 sales-record-response.mapping；
// 台位费展示名见 sales-record-display-name.utils；
// 增强数据（扫码点餐 / 空间会话规格）见 sales-record-enrichment；
// 报表行聚合见 sales-record-report-aggregation。
import { Prisma } from '@prisma/client';
import {
  isAmountDeductionSalesRecordRow,
  isNonQuantitySalesRecordRow,
  SELF_ORDER_DEDUCTION_PRODUCT_NAME,
  TABLE_FEE_NAME_RE,
} from '../../commerce/commerce.utils';
import { Money } from '../../../shared/money.utils';
import {
  buildVisibleSalesRecordRows,
  type SalesRecordItemRow,
} from './sales-record-item-aggregation';
import {
  SalesRecordAmountsDomain,
  type SalesRecordAmountsSnapshot,
} from './sales-record-amounts.domain';
import type { PreparedSalesItem } from './sales-record-item-preparation.service';
import type { SalesReportOrder } from './sales-record-report.query';

// ---------------------------------------------------------------------------
// 订单查询形态
// ---------------------------------------------------------------------------

export type SaleOrderWithItems = Prisma.SaleOrderGetPayload<{
  select: {
    id: true;
    // 与空间会话核对门店一致（空间结账单来源标记）
    storeId: true;
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
        // 订单来源判定：只有真实关联到「已结账」空间会话的销售单才算空间结账单
        status: true;
        storeId: true;
        // 券程可抵台位费（分）：券预设的 1 小时台位费 / 固定价
        hourlyRate: true;
        // 开台预付（分）与实际支付方式：销售记录「开台预付」收款事件的数据源
        prepaidAmount: true;
        prepaidPaymentMethod: true;
        prepaidCustomerPaymentMethod: true;
        // 开台信息：列表卡片展示「开台时间 + 开台操作员 → 结账时间 + 结账操作员」
        startTime: true;
        // 自动结账会话由系统用户落单，结账操作员按此标记兜底为「空间自动结账」
        autoCheckout: true;
        openOperatorNameSnapshot: true;
        openOperatorStaff: {
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
// 订单级金额
// ---------------------------------------------------------------------------

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
export function buildAmountsPreparedItems(
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
    countsTowardTotalQuantity: !isNonQuantitySalesRecordRow(
      item.productName,
      item.categoryName,
    ),
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
export function isGrouponVoucherSettledOrder(order: SalesReportOrder): boolean {
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

/** 团购券单的金额调整结果（营业额 / 利润 / 消费构成） */
interface GrouponVoucherAdjustment {
  totalRevenue: number;
  totalProfit: number;
  /** 无台位费行（纯点单用券）时为 null，表示沿用商品行口径 */
  breakdown: GrouponVoucherBreakdown | null;
}

/**
 * 团购券结算单的金额调整：券程台位费按券实际抵扣计收（min(台位费, 券程, 券面)），
 * 超时台位费由顾客到店另付，点单全额计入。
 */
function resolveGrouponVoucherAdjustment(
  order: SalesReportOrder,
  visibleRows: SalesRecordItemRow[],
  amountsSnapshot: SalesRecordAmountsSnapshot,
): GrouponVoucherAdjustment {
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
  if (!tableFeeRevenue.isPositive()) {
    return {
      totalRevenue: amountsSnapshot.totalRevenue,
      totalProfit: amountsSnapshot.totalProfit,
      breakdown: null,
    };
  }

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

  return {
    totalRevenue: adjusted.totalRevenue,
    totalProfit: adjusted.totalProfit,
    breakdown: {
      voucherCoveredRevenue: adjusted.voucherCoveredRevenue,
      // 收款明细的券抵段按券面全额记（不按台位费分钟数折算）
      voucherFaceRevenue: Money.fromDbCents(
        order.voucherFaceAmount!,
      ).toOutputYuan(),
      overtimeRevenue: adjusted.overtimeRevenue,
      itemsRevenue,
    },
  };
}

/**
 * 解析订单级金额（列表 / 报表 / CSV / 打印唯一口径）。
 *
 * 已退款订单的营业额、利润、实付一律归零：退款后这笔钱不再是收入，
 * 归零必须发生在**后端金额映射层**，否则列表卡片、打印页、CSV 明细各自判断
 * `refundedAt`，任一出口漏判就会出现「汇总已排除、明细仍显示原额」的自相矛盾。
 * 件数保留真实销量（退款状态另有专列展示），不做归零。
 *
 * 团购券空间订单：券程台位费按券实际抵扣计收（min(台位费, 券程, 券面)），
 * 超时台位费由顾客到店另付，点单全额计入；其余订单沿用商品行聚合结果。
 */
export function resolveSalesRecordAmounts(
  order: SalesReportOrder,
  visibleRows: SalesRecordItemRow[],
  amountsSnapshot: SalesRecordAmountsSnapshot,
): SalesRecordOrderAmounts {
  if (order.refund?.refundedAt) {
    return {
      totalRevenue: 0,
      totalProfit: 0,
      totalQuantity: amountsSnapshot.totalQuantity,
      payableAmount: 0,
      grouponVoucherBreakdown: null,
    };
  }

  let totalRevenue = amountsSnapshot.totalRevenue;
  let totalProfit = amountsSnapshot.totalProfit;
  let grouponVoucherBreakdown: GrouponVoucherBreakdown | null = null;

  if (isGrouponVoucherSettledOrder(order)) {
    const adjustment = resolveGrouponVoucherAdjustment(
      order,
      visibleRows,
      amountsSnapshot,
    );
    totalRevenue = adjustment.totalRevenue;
    totalProfit = adjustment.totalProfit;
    grouponVoucherBreakdown = adjustment.breakdown;
  }

  // 实付金额 = 本单营业额（营业额与实付同口径）：
  // - 团购券订单：券实际抵扣 + 超时台位费 + 点单；
  // - 其余订单：本次消费额。预付/续费抵扣只是分次收款（钱已真实收到，不减），
  //   抵扣超过消费时（如续费券 ¥35.2 本次只消费 ¥1.64）多余部分在结账时退回顾客
  //   （产品口径：超额按退款处理，见 buildSalesRecordPaymentEvents 的 checkout_refund），
  //   营业额仍按本次消费额记，既不出现负数也不凭空放大。
  const payableAmount = Math.max(0, totalRevenue);

  return {
    totalRevenue,
    totalProfit,
    totalQuantity: amountsSnapshot.totalQuantity,
    payableAmount,
    grouponVoucherBreakdown,
  };
}

/** 便于 CSV / 报表调用：内部构建可见行并完成金额聚合。 */
export function resolveSalesRecordAmountsFromOrder(
  order: SalesReportOrder,
): SalesRecordOrderAmounts {
  const visibleRows = buildVisibleSalesRecordRows(order);
  const amountsSnapshot = SalesRecordAmountsDomain.aggregateFromPreparedItems(
    buildAmountsPreparedItems(visibleRows),
  );
  return resolveSalesRecordAmounts(order, visibleRows, amountsSnapshot);
}
