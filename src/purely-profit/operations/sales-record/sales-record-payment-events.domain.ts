// 销售记录「收款 / 退款事件」域：把实付金额拆成逐笔带真实支付方式的收退款明细。
// 实付金额口径见 sales-record.domain 的 resolveSalesRecordAmounts。
import { Money } from '../../../shared/money.utils';
import type {
  GrouponVoucherBreakdown,
  SaleOrderWithItems,
} from './sales-record.domain';

/** 团购券预付判定所需的最小订单形态（列表 / CSV / 响应映射都能直接传入）。 */
interface VoucherPrepaidSource {
  customerPaymentMethod?: string | null;
  voucherCode?: string | null;
  voucherPlatform?: string | null;
  spaceSession?: { prepaidCustomerPaymentMethod?: string | null } | null;
}

/**
 * 是否真的用了团购券（开台券口径）。
 *
 * 不能只看券面金额字段：历史数据里现金 / 微信等预付的实收金额曾被误写进
 * 券面字段（前端开台入参把实收金额回退给了券面金额），只凭金额会把现金预付
 * 错标成「开台券 团购」并多出「券面金额」。因此必须有券标识才认定为券预付。
 */
export function isVoucherPrepaidOrder(order: VoucherPrepaidSource): boolean {
  if (String(order.customerPaymentMethod ?? '') === 'groupon_voucher') return true;
  if (order.voucherCode || order.voucherPlatform) return true;
  return order.spaceSession?.prepaidCustomerPaymentMethod === 'groupon_voucher';
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
   * - 其余订单（资金流口径）：open_voucher 开台券 / prepaid 开台预付（现金等非券方式）
   *   / renew 续费 / checkout_due 结账补差 / checkout_refund 结账退款
   */
  kind:
    | 'open_voucher'
    | 'prepaid'
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

/** 结账使用的支付方式：顾客选定优先，缺省按现金 */
function resolveCheckoutMethod(order: SaleOrderWithItems): string {
  return String(order.customerPaymentMethod ?? order.paymentMethod ?? 'cash');
}

/** 团购平台字段：仅券类事件输出，缺失时不带该键 */
function buildPlatformField(order: SaleOrderWithItems): { platform?: string } {
  const platform = order.voucherPlatform ?? order.grouponPlatform;
  return platform ? { platform } : {};
}

/**
 * 结账差额事件：正数按结账方式补收，负数按结账方式退回，零则不产生事件。
 * 方向按「分」判定，避免元级浮点残差产生 0 元事件。
 */
function buildCheckoutDeltaEvent(
  delta: Money,
  method: string,
): SalesRecordPaymentEvent | null {
  const deltaCents = Math.round(delta.toOutputYuan() * 100);
  if (deltaCents > 0) {
    return {
      kind: 'checkout_due',
      method,
      amount: delta.toOutputYuan(),
      direction: 'in',
    };
  }
  if (deltaCents < 0) {
    return {
      kind: 'checkout_refund',
      method,
      amount: Money.fromDbCents(-deltaCents).toOutputYuan(),
      direction: 'out',
    };
  }
  return null;
}

/**
 * 团购券结算单：券抵 + 结账两段——
 * 「券抵台位费」= 券面金额（顾客买券付的钱，按券面全额记，不按台位费实际分钟数折算）；
 * 差额按结账方式收或退：券面 < 实付 → 结账补付；券面 > 实付 → 结账退款
 * （产品口径：超额部分一律按退款处理，不存在「转余额」）。
 */
function buildVoucherSettledEvents(
  order: SaleOrderWithItems,
  payableAmount: number,
  breakdown: GrouponVoucherBreakdown,
): SalesRecordPaymentEvent[] {
  const events: SalesRecordPaymentEvent[] = [];
  const voucherPart = Money.fromInputYuan(breakdown.voucherFaceRevenue);
  if (voucherPart.isPositive()) {
    events.push({
      kind: 'voucher_table_fee',
      method: 'groupon_voucher',
      ...buildPlatformField(order),
      amount: voucherPart.toOutputYuan(),
      direction: 'in',
    });
  }
  const deltaEvent = buildCheckoutDeltaEvent(
    Money.fromInputYuan(payableAmount).subtract(voucherPart),
    resolveCheckoutMethod(order),
  );
  if (deltaEvent) events.push(deltaEvent);
  return events;
}

/** 续费收款事件：按支付方式合并（多条续费方式不同时前端分多行展示） */
function buildRenewEvents(order: SaleOrderWithItems): {
  events: SalesRecordPaymentEvent[];
  collected: Money;
} {
  const renewByMethod = new Map<string, Money>();
  let collected = Money.zero();
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
  const events: SalesRecordPaymentEvent[] = [];
  for (const [method, amount] of renewByMethod) {
    events.push({
      kind: 'renew',
      method,
      amount: amount.toOutputYuan(),
      direction: 'in',
    });
  }
  return { events, collected };
}

/** 资金流口径：开台预付（券 / 非券）+ 续费 + 结账补差 / 结账退款 */
function buildFundFlowEvents(
  order: SaleOrderWithItems,
  payableAmount: number,
): SalesRecordPaymentEvent[] {
  const events: SalesRecordPaymentEvent[] = [];
  let collected = Money.zero();

  // ① 开台预付：团购券按券面记「开台券」，其余方式按实收金额记「开台预付」
  const faceAmount =
    order.voucherFaceAmount == null
      ? Money.zero()
      : Money.fromDbCents(order.voucherFaceAmount);
  if (faceAmount.isPositive() && isVoucherPrepaidOrder(order)) {
    events.push({
      kind: 'open_voucher',
      method: 'groupon_voucher',
      ...buildPlatformField(order),
      amount: faceAmount.toOutputYuan(),
      direction: 'in',
    });
    collected = collected.add(faceAmount);
  } else {
    // 现金 / 微信 / 支付宝 / 刷卡等预付：开台已收款，必须单独成行，
    // 否则「结账」金额会等于全部消费，与实际结账只收差额对不上
    const prepaidFen = order.spaceSession?.prepaidAmount ?? 0;
    if (prepaidFen > 0) {
      const prepaidMoney = Money.fromDbCents(prepaidFen);
      events.push({
        kind: 'prepaid',
        method: String(order.spaceSession?.prepaidPaymentMethod ?? 'cash'),
        amount: prepaidMoney.toOutputYuan(),
        direction: 'in',
      });
      collected = collected.add(prepaidMoney);
    }
  }

  // ② 续费
  const renew = buildRenewEvents(order);
  events.push(...renew.events);
  collected = collected.add(renew.collected);

  // ③ 结账补差 / ④ 结账退款：差额按结账选择的支付方式收或退
  const deltaEvent = buildCheckoutDeltaEvent(
    Money.fromInputYuan(payableAmount).subtract(collected),
    resolveCheckoutMethod(order),
  );
  if (deltaEvent) events.push(deltaEvent);

  return events;
}

export function buildSalesRecordPaymentEvents(
  order: SaleOrderWithItems,
  payableAmount: number,
  grouponVoucherBreakdown?: GrouponVoucherBreakdown | null,
): SalesRecordPaymentEvent[] {
  // 已退款订单不拆收款来源（实付为 0）
  if (order.refund?.refundedAt) return [];
  if (grouponVoucherBreakdown) {
    return buildVoucherSettledEvents(
      order,
      payableAmount,
      grouponVoucherBreakdown,
    );
  }
  return buildFundFlowEvents(order, payableAmount);
}
