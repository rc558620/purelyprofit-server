/**
 * 结账多资产核销：抵扣明细归一化 + 额度规划（纯计算，不访问数据库）。
 *
 * 口径（与 purelyProfit 结账弹窗 checkoutSettlement.calc.ts 对齐，后端为权威）：
 *  1. 叠加顺序固定「会员卡 → 团购券 → 储值余额」，每一步都以剩余应付为上限；
 *  2. 会员卡只能抵台位费，且不超过台位费（时间权益核销，不能抵商品）；
 *  3. 团购券只能抵商品，且不超过商品费（券面是商品消费的支付凭证）；
 *  4. 储值余额抵「抵扣后剩余应付」，同时不超过会员可用余额；
 *  5. 任一项超上限一律 400，不做静默截断——否则前端展示的应付与实际核销
 *     金额会出现无法解释的差异，且卡/券/余额的账务记录对不上。
 */
import { BadRequestException } from '@nestjs/common';
import { Money } from '../../../shared/money.utils';
import type {
  SpaceCheckoutSettlementKindValue,
  SpaceCheckoutSettlementTargetValue,
} from './dto/space-session.constants';
import type { CheckoutSettlementItemDto } from './dto/space-session.dto';
import type { CheckoutSettlementInput } from './space-sessions.types';

/** 资产类型 → 唯一合法作用对象：防止「券抵台位费」「卡抵商品」这类越权口径 */
const SETTLEMENT_TARGET_BY_KIND: Record<
  SpaceCheckoutSettlementKindValue,
  SpaceCheckoutSettlementTargetValue
> = {
  member_card: 'time_fee',
  voucher: 'items',
  balance: 'total',
};

const SETTLEMENT_KIND_LABEL: Record<SpaceCheckoutSettlementKindValue, string> =
  {
    member_card: '会员卡',
    voucher: '团购券',
    balance: '储值余额',
  };

const MEMBER_CARD_ASSET_ID_PATTERN = /^\d+$/;

/**
 * 把请求 DTO 归一化为内部抵扣明细：
 * 去掉字符串空白、校验「类型 ↔ 作用对象」匹配、同类资产不允许重复出现。
 */
export const normalizeCheckoutSettlements = (
  items: CheckoutSettlementItemDto[] | undefined,
): CheckoutSettlementInput[] => {
  if (!items || items.length === 0) {
    return [];
  }

  const seen = new Set<SpaceCheckoutSettlementKindValue>();
  return items.map((item) => {
    const kindLabel = SETTLEMENT_KIND_LABEL[item.kind];
    if (seen.has(item.kind)) {
      throw new BadRequestException(`抵扣明细中「${kindLabel}」重复出现`);
    }
    seen.add(item.kind);

    const expectedTarget = SETTLEMENT_TARGET_BY_KIND[item.kind];
    if (item.target !== expectedTarget) {
      throw new BadRequestException(
        `「${kindLabel}」只能作用于 ${expectedTarget}，收到 ${item.target}`,
      );
    }

    const assetId = item.assetId?.trim();
    if (item.kind === 'member_card') {
      if (!assetId || !MEMBER_CARD_ASSET_ID_PATTERN.test(assetId)) {
        throw new BadRequestException('会员卡抵扣缺少合法的持卡实例 ID');
      }
    }
    if (item.kind === 'voucher' && !assetId) {
      throw new BadRequestException('团购券抵扣缺少券码');
    }

    const assetLabel = item.assetLabel?.trim();
    return {
      kind: item.kind,
      target: item.target,
      ...(assetId ? { assetId } : {}),
      ...(assetLabel ? { assetLabel } : {}),
      amount: item.amount,
    };
  });
};

/** 取某一类资产的抵扣金额；未出现该资产时返回 0 */
export const findCheckoutSettlementMoney = (
  settlements: CheckoutSettlementInput[],
  kind: SpaceCheckoutSettlementKindValue,
): Money => {
  const matched = settlements.find((item) => item.kind === kind);
  return matched ? Money.fromInputYuan(matched.amount) : Money.zero();
};

/** 取某一类资产的资产标识（卡=持卡实例 ID，券=券码，余额=会员 ID） */
export const findCheckoutSettlementAssetId = (
  settlements: CheckoutSettlementInput[],
  kind: SpaceCheckoutSettlementKindValue,
): string | null => {
  const matched = settlements.find((item) => item.kind === kind);
  return matched?.assetId ?? null;
};

export interface CheckoutSettlementPlanParams {
  /** 抵扣前权威应收（元）：含券面/预付/自助下单抵扣行，不含本次卡抵扣 */
  basePayableMoney: Money;
  /** 台位费（元）：会员卡抵扣上限 */
  timeCostMoney: Money;
  /** 商品费（元）：团购券抵扣上限 */
  itemsCostMoney: Money;
  /** 已归一化的抵扣明细 */
  settlements: CheckoutSettlementInput[];
  /** 会话会员可用储值余额（分）；null = 未识别会员，余额抵扣一律拒绝 */
  customerBalanceCents: number | null;
}

export interface CheckoutSettlementPlan {
  cardDeductionMoney: Money;
  voucherDeductionMoney: Money;
  balanceDeductionMoney: Money;
  /** 全部抵扣后的后端权威应付（元，非负） */
  payableMoney: Money;
}

const assertWithinCap = (
  requested: Money,
  cap: Money,
  label: string,
  capLabel: string,
): void => {
  // 额度下限为 0：台位费/商品费可能因历史抵扣行为负值，此时该资产不可用而不是「全部可用」
  const effectiveCap = Money.max(cap, Money.zero());
  if (!requested.greaterThan(effectiveCap)) {
    return;
  }
  throw new BadRequestException(
    `${label} ${requested.toFixedOutputYuan()} 元超过上限 ${effectiveCap.toFixedOutputYuan()} 元（${capLabel}）`,
  );
};

const resolveBalanceCapMoney = (
  params: CheckoutSettlementPlanParams,
  requested: Money,
  remainingMoney: Money,
): Money => {
  if (params.customerBalanceCents === null) {
    if (requested.isPositive()) {
      throw new BadRequestException('该会话未识别会员，无法使用储值余额抵扣');
    }
    return Money.zero();
  }
  return Money.min(
    Money.fromDbCents(params.customerBalanceCents),
    remainingMoney,
  );
};

/**
 * 规划本次结账的资产抵扣额度。
 *
 * 三个上限逐级扣减：卡（台位费）→ 券（商品费）→ 余额（剩余应付），
 * 返回的每个金额都经过上限夹紧校验，调用方可直接落库/写入账务。
 */
export const planCheckoutSettlements = (
  params: CheckoutSettlementPlanParams,
): CheckoutSettlementPlan => {
  const basePayableMoney = Money.max(params.basePayableMoney, Money.zero());

  const cardRequested = findCheckoutSettlementMoney(
    params.settlements,
    'member_card',
  );
  const cardCapMoney = Money.min(params.timeCostMoney, basePayableMoney);
  assertWithinCap(cardRequested, cardCapMoney, '会员卡抵扣', '本次台位费');
  const remainingAfterCard =
    basePayableMoney.subtractClampedToZero(cardRequested);

  const voucherRequested = findCheckoutSettlementMoney(
    params.settlements,
    'voucher',
  );
  const voucherCapMoney = Money.min(params.itemsCostMoney, remainingAfterCard);
  assertWithinCap(
    voucherRequested,
    voucherCapMoney,
    '团购券抵扣',
    voucherRequested.greaterThan(params.itemsCostMoney)
      ? '本次商品金额'
      : '剩余应付',
  );
  const remainingAfterVoucher =
    remainingAfterCard.subtractClampedToZero(voucherRequested);

  const balanceRequested = findCheckoutSettlementMoney(
    params.settlements,
    'balance',
  );
  const balanceCapMoney = resolveBalanceCapMoney(
    params,
    balanceRequested,
    remainingAfterVoucher,
  );
  assertWithinCap(
    balanceRequested,
    balanceCapMoney,
    '储值余额抵扣',
    '剩余应付或可用余额',
  );

  return {
    cardDeductionMoney: cardRequested,
    voucherDeductionMoney: voucherRequested,
    balanceDeductionMoney: balanceRequested,
    payableMoney: remainingAfterVoucher.subtractClampedToZero(balanceRequested),
  };
};

/**
 * 与前端预期应付比对。
 *
 * 锁单可能过期、期间又追加了商品或改了台位费口径，前端算出的应付会失真；
 * 后端权威应收与之不一致时直接拒绝，让收银重新预览，避免「收错钱」。
 */
export const assertExpectedPayableMatches = (params: {
  expectedPayable?: number;
  payableMoney: Money;
}): void => {
  if (params.expectedPayable === undefined) {
    return;
  }
  const expectedMoney = Money.fromInputYuan(params.expectedPayable);
  if (expectedMoney.equals(params.payableMoney)) {
    return;
  }
  throw new BadRequestException(
    `结账金额已变化：后端应付 ${params.payableMoney.toFixedOutputYuan()} 元，前端预期 ${expectedMoney.toFixedOutputYuan()} 元，请重新打开结账预览后再提交`,
  );
};
