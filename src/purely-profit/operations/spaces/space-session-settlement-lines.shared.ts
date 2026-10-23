import { SpaceBillingMode as PrismaSpaceBillingMode } from '@prisma/client';
import { Money } from '../../../shared/money.utils';
import {
  SELF_ORDER_DEDUCTION_PRODUCT_ID,
  SELF_ORDER_DEDUCTION_PRODUCT_NAME,
} from '../../commerce/commerce.utils';
import type { SpaceTimeFeeModeValue } from './dto/space-session.constants';
import { calcTimeCostMoney } from './space-session-settlement-time.shared';
import {
  GROUPON_VOUCHER_CATEGORY_NAME,
  GROUPON_VOUCHER_FALLBACK_PRODUCT_NAME,
  GROUPON_VOUCHER_ITEM_SUFFIX,
  SELF_ORDER_ITEM_SOURCE_TYPE,
  SYS_GROUPON_VOUCHER_PRODUCT_ID,
  SYS_PREPAID_DEDUCTION_PRODUCT_ID,
  SYS_RENEW_DEDUCTION_PRODUCT_ID,
  SYS_TIME_BILLING_PRODUCT_ID,
  VENUE_ORDER_ITEM_CATEGORY_NAME,
  sumSelfOrderDeductionMoney,
} from './space-session-settlement-system-item.shared';
import type {
  GrouponVoucherCostSnapshot,
  SpaceSessionItemRecord,
  SpaceSessionRecord,
  SpaceSessionRenewRecord,
  SpaceSessionSettlementRecord,
} from './space-sessions.types';

/**
 * 台位费行：按计时模式（timed = 按时长累计 / unit_price = 固定一口价）生成。
 * 非 items 计费模式且有时薪时才计费，否则返回 null。
 */
export const resolveSpaceTimeBillingOrderItem = (params: {
  session: Pick<
    SpaceSessionSettlementRecord,
    'billingMode' | 'hourlyRate' | 'startTime'
  >;
  checkoutAt: number;
  timeFeeMode: SpaceTimeFeeModeValue;
  durationLabel: string;
}): { timeCostMoney: Money; orderItem: SpaceSessionItemRecord } | null => {
  const { session, checkoutAt, timeFeeMode, durationLabel } = params;
  if (
    session.billingMode === PrismaSpaceBillingMode.items ||
    session.hourlyRate === null
  ) {
    return null;
  }

  const hourlyRateMoney = Money.fromDbCents(session.hourlyRate);
  const useUnitPrice = timeFeeMode === 'unit_price';
  const timeCostMoney = useUnitPrice
    ? hourlyRateMoney
    : calcTimeCostMoney(
        session.startTime.getTime(),
        checkoutAt,
        hourlyRateMoney,
      );
  const timeCostYuan = timeCostMoney.toOutputYuan();

  return {
    timeCostMoney,
    orderItem: {
      productId: SYS_TIME_BILLING_PRODUCT_ID,
      productName: useUnitPrice ? '台位费（固定）' : `台位费 ${durationLabel}`,
      categoryName: VENUE_ORDER_ITEM_CATEGORY_NAME,
      salePrice: timeCostYuan,
      profit: timeCostYuan,
      quantity: 1,
      lineTotal: timeCostYuan,
    },
  };
};

/**
 * Bug 4 fix: 续费抵扣取 amount 与 voucherFaceAmount 的较大值
 * 与 renew.service 中 addedMinutes 计算口径一致（"花 80 享 100"按 100 元抵扣）
 */
export const resolveRenewDeductionOrderItem = (
  renewRecords: SpaceSessionRenewRecord[],
): { renewDeductionMoney: Money; orderItem: SpaceSessionItemRecord | null } => {
  const renewDeductionMoney = renewRecords.reduce((sum, record) => {
    const amountMoney = Money.fromInputYuan(record.amount);
    const effectiveMoney =
      record.voucherFaceAmount !== undefined
        ? Money.max(amountMoney, Money.fromInputYuan(record.voucherFaceAmount))
        : amountMoney;
    return sum.add(effectiveMoney);
  }, Money.zero());

  if (!renewDeductionMoney.isPositive()) {
    return { renewDeductionMoney, orderItem: null };
  }

  const renewDeductionYuan = renewDeductionMoney.toOutputYuan();
  return {
    renewDeductionMoney,
    orderItem: {
      productId: SYS_RENEW_DEDUCTION_PRODUCT_ID,
      productName: '续费抵扣',
      categoryName: VENUE_ORDER_ITEM_CATEGORY_NAME,
      salePrice: -renewDeductionYuan,
      profit: -renewDeductionYuan,
      quantity: 1,
      lineTotal: -renewDeductionYuan,
    },
  };
};

/**
 * G1/G2 fix: 预付抵扣取 prepaidAmount 与 prepaidVoucherFaceAmount 的较大值。
 * 与续费链路 renewDeduction 的 max(amount, voucherFaceAmount) 口径一致。
 * 场景：开台预付团购"花 80 享 100"→ 按 100 元抵扣；
 *       结账时团购券面金额同样纳入抵扣，避免"已计费但无人支付"的缺口。
 *
 * 该口径同时供「正向券面消费行」复用：两条行必须取**完全相同**的金额，
 * 正负相消后合计才恒等于本次现场消费金额（不会出现"应退金额"）。
 */
const resolvePrepaidEffectiveMoney = (
  session: Pick<
    SpaceSessionRecord,
    'prepaidAmount' | 'prepaidVoucherFaceAmount'
  >,
): Money => {
  const prepaidMoney =
    session.prepaidAmount !== null
      ? Money.fromDbCents(session.prepaidAmount)
      : Money.zero();
  const voucherMoney =
    session.prepaidVoucherFaceAmount !== null
      ? Money.fromDbCents(session.prepaidVoucherFaceAmount)
      : Money.zero();
  return Money.max(prepaidMoney, voucherMoney);
};

/**
 * 券面消费行应扣的商品成本。
 *
 * 券面金额 = 本次核销的券面额，可能对应多张券（一次买 2 张并开台核销），
 * 因此按「券面额 ÷ 券单价」折算件数再乘单件成本；
 * 单价缺失（历史数据）时按 1 件计，避免多扣。
 *
 * 无条件返回零成本的情形：券单未快照成本价（历史订单）→ 保持原「利润 = 券面」口径。
 */
const buildVoucherCostMoney = (
  consumptionMoney: Money,
  voucherCost?: GrouponVoucherCostSnapshot,
): Money => {
  const unitCostFen = voucherCost?.unitCostFen;
  if (unitCostFen == null || unitCostFen <= 0) {
    return Money.zero();
  }

  const unitPriceFen = voucherCost?.unitPriceFen;
  const pieces =
    unitPriceFen && unitPriceFen > 0
      ? Math.max(1, Math.round(consumptionMoney.toDbCents() / unitPriceFen))
      : 1;

  return Money.fromDbCents(unitCostFen * pieces);
};

/**
 * 纯消费（items）模式 + 开台团购券：券面金额的**正向消费行**。
 *
 * 为什么只在 items 模式生成：
 *  timed / mixed / countdown 模式有台位费行，券面已通过券程口径
 *  （min(台位费, 券程, 券面)）计入营业额，再补一条正向行会重复计收入；
 *  纯消费模式没有台位费行，券面此前**完全不进账**（营业额/护理档案均为 0），
 *  必须补这条正向行，券面才是门店真实营收（券面 = 顾客买券实付 = 门店结算收入）。
 *
 * 与负向「预付款」抵扣行成对出现、金额相等符号相反：
 *   消费合计（营业额/护理档案）= 点单 + 券面
 *   客人现场应付            = 点单（券已在线支付，不重复收、券余额不退）
 *
 * 非 items 模式 / 无券码 / 券面为 0 → 返回 null，行为与改动前完全一致。
 */
export const resolveGrouponVoucherConsumptionItem = (params: {
  session: Pick<
    SpaceSessionRecord,
    | 'billingMode'
    | 'prepaidVoucherCode'
    | 'prepaidGrouponCode'
    | 'prepaidAmount'
    | 'prepaidVoucherFaceAmount'
  >;
  /** 券对应商品名（purelyClub 团购商品，如「分手大师」）；查不到时按兜底名展示 */
  voucherProductName?: string | null;
  /** 券商品成本快照（下单时固化）；无快照的历史券单保持「利润 = 券面」原口径 */
  voucherCost?: GrouponVoucherCostSnapshot;
}): {
  voucherConsumptionMoney: Money;
  orderItem: SpaceSessionItemRecord | null;
} => {
  const { session, voucherProductName, voucherCost } = params;
  if (session.billingMode !== PrismaSpaceBillingMode.items) {
    return { voucherConsumptionMoney: Money.zero(), orderItem: null };
  }

  const voucherCode =
    session.prepaidVoucherCode?.trim() || session.prepaidGrouponCode?.trim();
  if (!voucherCode) {
    return { voucherConsumptionMoney: Money.zero(), orderItem: null };
  }

  const voucherConsumptionMoney = resolvePrepaidEffectiveMoney(session);
  if (!voucherConsumptionMoney.isPositive()) {
    return { voucherConsumptionMoney: Money.zero(), orderItem: null };
  }

  const consumptionYuan = voucherConsumptionMoney.toOutputYuan();
  const trimmedProductName = voucherProductName?.trim();
  // 利润 = 券面 - 商品成本（有成本快照时）；可能出现的负值如实保留（券面低于成本的亏损核销）
  const profitMoney = voucherConsumptionMoney.subtract(
    buildVoucherCostMoney(voucherConsumptionMoney, voucherCost),
  );

  return {
    voucherConsumptionMoney,
    orderItem: {
      productId: SYS_GROUPON_VOUCHER_PRODUCT_ID,
      productName: trimmedProductName
        ? `${trimmedProductName}${GROUPON_VOUCHER_ITEM_SUFFIX}`
        : GROUPON_VOUCHER_FALLBACK_PRODUCT_NAME,
      categoryName: GROUPON_VOUCHER_CATEGORY_NAME,
      salePrice: consumptionYuan,
      profit: profitMoney.toOutputYuan(),
      quantity: 1,
      lineTotal: consumptionYuan,
    },
  };
};

export const resolvePrepaidDeductionOrderItem = (
  session: Pick<
    SpaceSessionRecord,
    'prepaidAmount' | 'prepaidVoucherFaceAmount'
  >,
): {
  prepaidDeductionMoney: Money;
  orderItem: SpaceSessionItemRecord | null;
} => {
  const effective = resolvePrepaidEffectiveMoney(session);
  const prepaidDeductionMoney = effective.isPositive()
    ? effective
    : Money.zero();

  if (!prepaidDeductionMoney.isPositive()) {
    return { prepaidDeductionMoney, orderItem: null };
  }

  const prepaidDeductionYuan = prepaidDeductionMoney.toOutputYuan();
  return {
    prepaidDeductionMoney,
    orderItem: {
      productId: SYS_PREPAID_DEDUCTION_PRODUCT_ID,
      productName: '预付款',
      categoryName: VENUE_ORDER_ITEM_CATEGORY_NAME,
      salePrice: -prepaidDeductionYuan,
      profit: -prepaidDeductionYuan,
      quantity: 1,
      lineTotal: -prepaidDeductionYuan,
    },
  };
};

/**
 * 自助下单抵扣：商品行来源为 member_self_order 时顾客已在小程序侧在线支付
 * （余额/微信），结算时按每个已支付商品生成一条独立负向抵扣明细行
 * （productName =「商品名 · 自助下单抵扣」，交班/销售记录展示为
 * 「A04 · 橙汁 · 自助下单抵扣」），把该商品行的金额与利润一并冲减为 0，
 * 防止空间账单重复收费。productId 统一为 SELF_ORDER_DEDUCTION_PRODUCT_ID，
 * isDeductionItem 识别逻辑不变；历史单据仍是一条总和行，由
 * isDeductionProductName 兼容识别。
 */
export const buildSelfOrderDeductionOrderItems = (
  items: SpaceSessionItemRecord[],
): SpaceSessionItemRecord[] => {
  if (!sumSelfOrderDeductionMoney(items).isPositive()) {
    return [];
  }

  return items
    .filter((item) => item.sourceType === SELF_ORDER_ITEM_SOURCE_TYPE)
    .map((item) => {
      const deductionYuan = Money.fromInputYuan(item.lineTotal).toOutputYuan();
      const itemProfitYuan = Money.fromInputYuan(item.profit)
        .multiply(item.quantity)
        .toOutputYuan();

      // 抵扣行商品名去掉规格后缀：规格由 specNames 单独承载（与商品行展示口径一致），
      // 否则销售记录会出现「深层清洁护理（60分钟）· 自助下单抵扣」与上方商品行
      // 「深层清洁护理 [规格] 60分钟」的规格重复展示。
      const specNames =
        Array.isArray(item.specNames) && item.specNames.length > 0
          ? item.specNames.filter(
              (name): name is string => typeof name === 'string',
            )
          : [];
      // 仅在确认有规格时才剥末尾的「（…）」，避免误删商品名自带的括号
      const baseName =
        specNames.length > 0
          ? item.productName.replace(/（[^）]*）$/, '')
          : item.productName;

      return {
        productId: SELF_ORDER_DEDUCTION_PRODUCT_ID,
        productName: `${baseName} · ${SELF_ORDER_DEDUCTION_PRODUCT_NAME}`,
        categoryName: '自助下单',
        salePrice: -deductionYuan,
        profit: -itemProfitYuan,
        quantity: 1,
        lineTotal: -deductionYuan,
        ...(specNames.length > 0
          ? {
              specSignature: item.specSignature ?? null,
              specNames,
            }
          : {}),
      };
    });
};
