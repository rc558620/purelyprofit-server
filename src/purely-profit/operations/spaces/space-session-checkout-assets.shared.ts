// 空间会话-结账多资产核销编排（卡 / 团购券 / 储值余额）。
//
// 职责：
//  1. resolveCheckoutAssets：事务内复核卡与余额、按权威结算重算各资产额度并比对前端预期应付；
//  2. applyCheckoutAssets：按固定顺序落账（卡确认扣次 → 余额条件扣减 → 团购券核销绑定）。
//
// 为什么必须重算而不是直接采信前端金额：
//  前端算的是「锁单时刻」的应付，锁单可能过期、期间又追加了商品或改了台位费口径；
//  这里以事务内重建的结算结果为准，前端金额只用于比对，不一致就直接拒绝。
import { BadRequestException, ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { Money } from '../../../shared/money.utils';
import {
  applyCheckoutMemberCard,
  resolveCheckoutMemberCard,
  type CheckoutMemberCardSnapshot,
} from './space-session-checkout-card.shared';
import {
  assertExpectedPayableMatches,
  findCheckoutSettlementAssetId,
  findCheckoutSettlementMoney,
  planCheckoutSettlements,
  type CheckoutSettlementPlan,
} from './space-session-checkout-settlement.shared';
import {
  assertVoucherReadable,
  bindVoucherOnOpen,
} from './space-session-voucher.shared';
import type {
  CheckoutSettlementInput,
  SpaceSessionSettlement,
} from './space-sessions.types';

/** 纯利宝团购券平台标识（结账核销只处理 purelyClub 券订单） */
const CHUNLIBAO_PLATFORM = 'chunlibao';

export interface ResolveCheckoutAssetsParams {
  /** 事务内重建的「抵扣前」权威结算（不含卡抵扣行） */
  baseSettlement: SpaceSessionSettlement;
  /** 已归一化的抵扣明细 */
  settlements: CheckoutSettlementInput[];
  /** 前端预期应付（元）；缺省表示无前端场景（自动结账），跳过比对 */
  expectedPayable?: number;
  session: {
    id: number;
    storeId: number;
    /** 会话识别的营销顾客（储值余额 / 会员卡归属） */
    customerId: number | null;
    /** 开台绑定的持卡实例 */
    activeCardId: number | null;
  };
  now?: Date;
}

export interface CheckoutAssetsResolution extends CheckoutSettlementPlan {
  card: CheckoutMemberCardSnapshot | null;
  /** 本次核销的团购券码（未使用券时为 null） */
  voucherCode: string | null;
  /** 余额抵扣归属标识（前端下发的 customerId 字符串），用于复核归属 */
  balanceAssetId: string | null;
  customerId: number | null;
}

const parseCardId = (assetId: string | null): number | null => {
  if (assetId === null) {
    return null;
  }
  const cardId = Number(assetId);
  if (!Number.isInteger(cardId) || cardId <= 0) {
    throw new BadRequestException('会员卡抵扣缺少合法的持卡实例 ID');
  }
  return cardId;
};

/** 读取会员可用储值余额（分）；顾客不存在 / 跨店时按 0 处理，交由额度校验报错 */
const loadCustomerBalanceCents = async (
  tx: Prisma.TransactionClient,
  storeId: number,
  customerId: number,
): Promise<number> => {
  const customer = await tx.marketingCustomer.findFirst({
    where: { id: customerId, storeId, deletedAt: null },
    select: { balance: true },
  });
  return customer?.balance ?? 0;
};

/**
 * 解析本次结账的资产核销方案（只读 + 校验，不产生写入）。
 */
export async function resolveCheckoutAssets(
  tx: Prisma.TransactionClient,
  params: ResolveCheckoutAssetsParams,
): Promise<CheckoutAssetsResolution> {
  const { session, settlements } = params;
  const membershipId = session.customerId ?? null;

  const card = await resolveCheckoutMemberCard(tx, {
    storeId: session.storeId,
    customerId: membershipId,
    activeCardId: session.activeCardId,
    selectedCardId: parseCardId(
      findCheckoutSettlementAssetId(settlements, 'member_card'),
    ),
    sessionId: session.id,
    now: params.now,
  });

  // 只有真的要用余额抵扣时才读余额：无余额抵扣的常规结账不额外多一次查询
  const needBalance = findCheckoutSettlementMoney(
    settlements,
    'balance',
  ).isPositive();
  const customerBalanceCents =
    needBalance && membershipId !== null
      ? await loadCustomerBalanceCents(tx, session.storeId, membershipId)
      : null;

  const plan = planCheckoutSettlements({
    basePayableMoney: Money.fromInputYuan(params.baseSettlement.totalAmount),
    timeCostMoney: Money.fromInputYuan(params.baseSettlement.timeCost),
    itemsCostMoney: Money.fromInputYuan(params.baseSettlement.itemsCost),
    settlements,
    customerBalanceCents,
  });

  assertExpectedPayableMatches({
    expectedPayable: params.expectedPayable,
    payableMoney: plan.payableMoney,
  });

  return {
    ...plan,
    card,
    voucherCode: findCheckoutSettlementAssetId(settlements, 'voucher'),
    balanceAssetId: findCheckoutSettlementAssetId(settlements, 'balance'),
    customerId: membershipId,
  };
}

export interface DeductCheckoutBalanceParams {
  storeId: number;
  customerId: number | null;
  /** settlements 中的余额归属标识：提供时必须与当前会话会员一致 */
  assetId: string | null;
  amountMoney: Money;
}

/**
 * 储值余额条件扣减（防超扣）。
 *
 * 只允许 balance >= 扣减额 时才命中更新：并发两笔结账同时扣同一笔余额时，
 * 后到的一笔命中 0 行 → 抛冲突回滚整笔结账，绝不会把余额扣成负数。
 */
export async function deductCheckoutCustomerBalance(
  tx: Prisma.TransactionClient,
  params: DeductCheckoutBalanceParams,
): Promise<void> {
  if (!params.amountMoney.isPositive()) {
    return;
  }
  const customerId = params.customerId;
  if (customerId === null) {
    throw new BadRequestException('该场次未识别会员，无法使用储值余额抵扣');
  }
  if (params.assetId !== null && params.assetId !== String(customerId)) {
    throw new BadRequestException('储值余额抵扣的会员与当前场次不一致');
  }

  const deducted = await tx.marketingCustomer.updateMany({
    where: {
      id: customerId,
      storeId: params.storeId,
      deletedAt: null,
      balance: { gte: params.amountMoney.toDbCents() },
    },
    data: { balance: { decrement: params.amountMoney.toDbCents() } },
  });
  if (deducted.count !== 1) {
    throw new ConflictException('储值余额不足或已被并发消费，请刷新后重试');
  }
}

export interface ConsumeCheckoutVoucherParams {
  storeId: number;
  sessionId: number;
  customerId: number | null;
  voucherCode: string | null;
  amountMoney: Money;
}

/**
 * 团购券结账核销：校验券可用性与归属 → 绑定到当前场次（pending/used-未开台 → used-已开台）。
 *
 * 绑定复用开台侧的 bindVoucherOnOpen（条件更新 + 已用冲突文案），
 * 保证「开台核销」与「结账核销」只有一套并发语义。
 */
export async function consumeCheckoutVoucher(
  tx: Prisma.TransactionClient,
  params: ConsumeCheckoutVoucherParams,
): Promise<void> {
  if (!params.amountMoney.isPositive()) {
    return;
  }
  const voucherCode = params.voucherCode;
  if (!voucherCode) {
    throw new BadRequestException('团购券抵扣缺少券码');
  }

  const order = await assertVoucherReadable(tx, voucherCode, params.storeId);
  if (
    params.customerId !== null &&
    order.customerId !== null &&
    order.customerId !== params.customerId
  ) {
    throw new BadRequestException('该团购券不属于当前会员，无法抵扣');
  }

  const faceMoney = Money.fromDbCents(order.paidAmountFen);
  if (params.amountMoney.greaterThan(faceMoney)) {
    throw new BadRequestException(
      `团购券抵扣不能超过券面金额 ${faceMoney.toFixedOutputYuan()} 元`,
    );
  }

  await bindVoucherOnOpen(tx, {
    voucherCode,
    voucherPlatform: CHUNLIBAO_PLATFORM,
    storeId: params.storeId,
    sessionId: params.sessionId,
  });
}

export interface ApplyCheckoutAssetsParams {
  resolution: CheckoutAssetsResolution;
  storeId: number;
  sessionId: number;
  saleOrderNo: string;
  spaceNameSnapshot: string;
  operatorStaffId?: number | null;
  operatorNameSnapshot?: string | null;
}

/**
 * 落账本次资产核销：顺序固定，任何一步失败整笔结账事务回滚。
 *
 * 顺序理由：卡先确认扣次（次数卡被重复使用比金额更敏感），
 * 余额与券随后扣减；三者的金额上限在 plan 阶段已相互扣减，顺序不影响总额。
 */
export async function applyCheckoutAssets(
  tx: Prisma.TransactionClient,
  params: ApplyCheckoutAssetsParams,
): Promise<void> {
  const { resolution } = params;
  if (resolution.card) {
    await applyCheckoutMemberCard(tx, {
      storeId: params.storeId,
      sessionId: params.sessionId,
      saleOrderNo: params.saleOrderNo,
      spaceNameSnapshot: params.spaceNameSnapshot,
      snapshot: resolution.card,
      operatorStaffId: params.operatorStaffId,
      operatorNameSnapshot: params.operatorNameSnapshot,
    });
  }

  await deductCheckoutCustomerBalance(tx, {
    storeId: params.storeId,
    customerId: resolution.customerId,
    assetId: resolution.balanceAssetId,
    amountMoney: resolution.balanceDeductionMoney,
  });

  await consumeCheckoutVoucher(tx, {
    storeId: params.storeId,
    sessionId: params.sessionId,
    customerId: resolution.customerId,
    voucherCode: resolution.voucherCode,
    amountMoney: resolution.voucherDeductionMoney,
  });
}
