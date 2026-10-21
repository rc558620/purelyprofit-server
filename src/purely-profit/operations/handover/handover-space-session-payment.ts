import { SalesPaymentMethod } from '@prisma/client';
import { Money } from '../../../shared/money.utils';
import {
  SELF_ORDER_DEDUCTION_PRODUCT_NAME,
  TABLE_FEE_NAME_RE,
} from '../../commerce/commerce.utils';
import {
  GROUPON_VOUCHER_CUSTOMER_PAYMENT_METHOD,
  GROUPON_VOUCHER_DISPLAY,
  PAYMENT_METHOD_CONFIG,
  SPACE_RENEW_DEDUCTION_ITEM_NAME,
  buildGrouponLabel,
  isPrepaidDeductionItem,
} from './handover.constants';
import type { PaymentOrderItemSource } from './handover.types';

/** 支付方式汇总视角下的空间会话（最小字段集） */
type PaymentSpaceSession = NonNullable<
  PaymentOrderItemSource['order']['spaceSession']
>;

/**
 * 空间会话消费行（台位费 / 追加点单）的「实际付款来源」解析。
 *
 * ─── 背景 ────────────────────────────────────────────────────────
 * 空间会话的资金是分批到账的：开台预付 → 续费 → 结账补收。
 * 消费行本身没有独立的收款动作，它的钱来自上面某几笔资金，
 * 因此支付方式不能一律取结账单（SaleOrder.paymentMethod）：
 *   - 预付款已覆盖台位费时，台位费的支付方式应为开台预付的支付方式
 *     （团购券开台 → 显示「淘宝团购」而非结账时的微信）；
 *   - 预付款 + 续费仍不够时，超出部分才是结账时收的，应显示结账支付方式。
 *
 * 规则：按资金到账顺序（预付 → 续费 → 结账补收）依次冲抵消费行
 * （冲抵顺序：台位费 → 追加点单，自助下单行专款专用不参与），
 * 取「覆盖完成该行的那一笔资金」作为该行的支付方式与券码。
 *
 * ─── 适用范围 ────────────────────────────────────────────────────
 * 仅空间会话订单（order.spaceSession 非空）会命中，餐饮账号无空间会话，
 * 天然不触发，无需额外的业态判断。
 */

/** 「商品名 · 自助下单抵扣」行后缀：自助下单已在线支付商品的冲减行 */
const SELF_ORDER_DEDUCTION_SUFFIX = ` · ${SELF_ORDER_DEDUCTION_PRODUCT_NAME}`;

export interface SpaceConsumptionPaymentSource {
  paymentMethod: SalesPaymentMethod;
  /** 团购券平台（仅团购券支付方式有值） */
  grouponPlatform: string | null;
  /** 团购券码（仅团购券支付方式有值） */
  grouponCode: string | null;
  paymentLabel: string;
  paymentColor: string;
}

/** saleOrderItem.id → 该消费行的实际付款来源 */
export type SpaceConsumptionPaymentIndex = ReadonlyMap<
  number,
  SpaceConsumptionPaymentSource
>;

/** 一笔到账资金 */
type FundingEntry = {
  amountCents: number;
  paymentMethod: SalesPaymentMethod;
  grouponPlatform: string | null;
  grouponCode: string | null;
};

const isSelfOrderDeductionRow = (productName: string): boolean =>
  productName.endsWith(SELF_ORDER_DEDUCTION_SUFFIX);

const isDeductionRow = (productName: string): boolean =>
  isPrepaidDeductionItem(productName) ||
  productName === SPACE_RENEW_DEDUCTION_ITEM_NAME ||
  isSelfOrderDeductionRow(productName);

const isTableFeeRow = (productName: string): boolean =>
  TABLE_FEE_NAME_RE.test(productName);

const toPaymentMethod = (
  raw: string | null | undefined,
  fallback: SalesPaymentMethod,
): SalesPaymentMethod =>
  raw && raw in PAYMENT_METHOD_CONFIG ? (raw as SalesPaymentMethod) : fallback;

/** 逐行金额（分）：salePrice（分）× quantity */
const lineAmountCents = (item: PaymentOrderItemSource): number =>
  Money.fromDbCents(item.salePrice).multiply(item.quantity).toDbCents();

const toPaymentSource = (fund: FundingEntry): SpaceConsumptionPaymentSource => {
  const isGroupon = fund.paymentMethod === SalesPaymentMethod.groupon_voucher;
  return {
    paymentMethod: fund.paymentMethod,
    grouponPlatform: fund.grouponPlatform,
    grouponCode: fund.grouponCode,
    paymentLabel: isGroupon
      ? buildGrouponLabel(fund.grouponPlatform)
      : PAYMENT_METHOD_CONFIG[fund.paymentMethod].label,
    paymentColor: isGroupon
      ? GROUPON_VOUCHER_DISPLAY.color
      : PAYMENT_METHOD_CONFIG[fund.paymentMethod].color,
  };
};

/** 续费记录按续费时间升序（先到账先冲抵） */
const sortRenewRecords = (
  records: PaymentSpaceSession['sessionRenewRecords'],
): typeof records =>
  [...records].sort((left, right) => {
    const leftAt = Number(left.renewedAt ?? 0);
    const rightAt = Number(right.renewedAt ?? 0);
    return leftAt === rightAt ? 0 : leftAt - rightAt;
  });

/**
 * 构建资金到账序列：开台预付 → 续费（按时间）→ 结账补收。
 * checkoutFundCents 为结账时补收的金额（消费 − 已付，可能为 0）。
 */
const buildFundingEntries = (
  session: PaymentSpaceSession,
  order: PaymentOrderItemSource['order'],
  checkoutFundCents: number,
): FundingEntry[] => {
  const entries: FundingEntry[] = [];

  const prepaidCents = Math.max(Number(session.prepaidAmount ?? 0), 0);
  if (prepaidCents > 0) {
    const isGrouponPrepaid =
      session.prepaidCustomerPaymentMethod ===
      GROUPON_VOUCHER_CUSTOMER_PAYMENT_METHOD;
    const paymentMethod = isGrouponPrepaid
      ? SalesPaymentMethod.groupon_voucher
      : toPaymentMethod(session.prepaidPaymentMethod, order.paymentMethod);
    entries.push({
      amountCents: prepaidCents,
      paymentMethod,
      grouponPlatform: isGrouponPrepaid ? session.prepaidGrouponPlatform : null,
      grouponCode: isGrouponPrepaid ? session.prepaidGrouponCode : null,
    });
  }

  for (const record of sortRenewRecords(session.sessionRenewRecords ?? [])) {
    const amountCents = Math.max(Number(record.amount ?? 0), 0);
    if (amountCents <= 0) continue;
    const paymentMethod = toPaymentMethod(
      record.paymentMethod,
      order.paymentMethod,
    );
    const isGroupon = paymentMethod === SalesPaymentMethod.groupon_voucher;
    entries.push({
      amountCents,
      paymentMethod,
      grouponPlatform: isGroupon ? record.grouponPlatform : null,
      grouponCode: isGroupon ? record.grouponCode : null,
    });
  }

  if (checkoutFundCents > 0) {
    const isGroupon =
      order.paymentMethod === SalesPaymentMethod.groupon_voucher;
    entries.push({
      amountCents: checkoutFundCents,
      paymentMethod: order.paymentMethod,
      grouponPlatform: null,
      grouponCode: isGroupon ? order.grouponCode : null,
    });
  }

  return entries;
};

/** 单个空间会话订单内的消费行按支付方式归属 */
const assignOrderGroup = (
  group: PaymentOrderItemSource[],
  index: Map<number, SpaceConsumptionPaymentSource>,
): void => {
  const items = [...group].sort((left, right) => left.id - right.id);
  const session = items[0].order.spaceSession;
  if (!session) return;

  // 自助下单商品行：由客人在线支付、且结算时已生成同名负向抵扣行冲减，
  // 属于专款专用，不参与资金冲抵（保持现状展示）。
  const selfOrderProductNames = new Set(
    items
      .filter((item) => isSelfOrderDeductionRow(item.productName))
      .map((item) =>
        item.productName.slice(0, -SELF_ORDER_DEDUCTION_SUFFIX.length),
      ),
  );

  const candidates = items.filter(
    (item) =>
      !isDeductionRow(item.productName) &&
      !selfOrderProductNames.has(item.productName),
  );
  // 冲抵顺序：台位费优先，其余（追加点单）按落库顺序
  const ordered = [
    ...candidates.filter((item) => isTableFeeRow(item.productName)),
    ...candidates.filter((item) => !isTableFeeRow(item.productName)),
  ];
  if (ordered.length === 0) return;

  const consumptionCents = ordered.reduce(
    (sum, item) => sum + Math.max(lineAmountCents(item), 0),
    0,
  );
  const paidCents =
    Math.max(Number(session.prepaidAmount ?? 0), 0) +
    (session.sessionRenewRecords ?? []).reduce(
      (sum, record) => sum + Math.max(Number(record.amount ?? 0), 0),
      0,
    );
  const funds = buildFundingEntries(
    session,
    items[0].order,
    Math.max(consumptionCents - paidCents, 0),
  );

  let fundIndex = 0;
  let fundRemainCents = funds.length > 0 ? funds[0].amountCents : 0;
  for (const item of ordered) {
    let remainingCents = Math.max(lineAmountCents(item), 0);
    let covering: FundingEntry | null = funds[fundIndex] ?? null;

    while (remainingCents > 0 && fundIndex < funds.length) {
      if (fundRemainCents >= remainingCents) {
        fundRemainCents -= remainingCents;
        remainingCents = 0;
        covering = funds[fundIndex];
        break;
      }
      remainingCents -= fundRemainCents;
      fundIndex += 1;
      if (fundIndex < funds.length) {
        fundRemainCents = funds[fundIndex].amountCents;
        covering = funds[fundIndex];
      } else {
        covering = null;
      }
    }

    // 资金耗尽（理论上不会发生，结账补收资金必然覆盖剩余消费）→ 回退结账支付方式
    const fallback: FundingEntry = {
      amountCents: 0,
      paymentMethod: item.order.paymentMethod,
      grouponPlatform: null,
      grouponCode: null,
    };
    index.set(item.id, toPaymentSource(covering ?? fallback));
  }
};

/**
 * 构建「消费行 → 实际付款来源」索引，供交班明细展示与支付方式金额汇总共用，
 * 保证两处口径完全一致。
 */
export const buildSpaceConsumptionPaymentIndex = (
  items: readonly PaymentOrderItemSource[],
): SpaceConsumptionPaymentIndex => {
  const groups = new Map<number, PaymentOrderItemSource[]>();
  for (const item of items) {
    if (!item.order.spaceSession) continue;
    const group = groups.get(item.order.id) ?? [];
    group.push(item);
    groups.set(item.order.id, group);
  }

  const index = new Map<number, SpaceConsumptionPaymentSource>();
  for (const [, group] of groups) {
    assignOrderGroup(group, index);
  }
  return index;
};
