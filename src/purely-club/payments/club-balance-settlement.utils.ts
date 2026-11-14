/**
 * 余额支付扣款内核：基于「条件扣减」原子扣减储值余额，可选同步顾客消费指标。
 *
 * 为什么必须唯一：
 * 余额扣减涉及资金安全，历史上有 5 条链路各写一遍 `updateMany + balance gte`，
 * 导致异常类型（BadRequest / Conflict）、累计消费口径（是否含积分抵扣）、
 * 是否校验 `status: 'active'` 三处口径分裂，对账时同一笔消费在不同业务线表现不一致。
 *
 * 统一后的职责边界：
 * - 本函数只负责「扣款 + 可选指标更新」，不写消费流水、不发积分、不处理幂等；
 * - 流水表 / 赠送积分 / 订单状态流转仍由各业务链路负责（它们口径确实不同）。
 */
import { CLUB_PAY_ERROR_CODE, clubPayError } from './club-pay.errors';
import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { calcCustomerTier } from '../../purely-profit/marketing/marketing.utils';
import { queryCustomerTierThresholds } from '../../purely-profit/marketing/marketing.query';
import { Money } from '../../shared/money.utils';

/** 与扣款同事务更新的顾客消费指标 */
export interface DebitCustomerBalanceMetrics {
  /**
   * 计入累计消费的金额（分）。
   *
   * 通常 = 扣款额 + 积分抵扣额，必须与消费流水 `amount` 同口径，
   * 否则物化字段会永远小于「流水实时聚合」。
   */
  settlementAmountFen: number;
  /** 调用方已读到的累计消费（用于计算等级），必须是扣款前的值 */
  currentTotalSpent: number;
}

export interface DebitCustomerBalanceParams {
  customerId: number;
  /** 门店 ID：扣款限定在该门店档案内，避免跨店扣错人 */
  storeId: number;
  /** 实际从余额扣减的金额（分） */
  balancePaidFen: number;
  /** 传入则同步累计消费 / 到店次数 / 等级；不传表示指标由调用方另行落账 */
  metrics?: DebitCustomerBalanceMetrics;
  /** 是否要求档案为 `active`（扫码点餐 / 自助点单口径），默认不额外校验 */
  requireActive?: boolean;
  /** 余额不足异常工厂：各业务线的异常类型与文案不同，缺省用统一文案 */
  buildInsufficientError?: () => Error;
}

/** 统一兜底文案：无法回读最新余额（并发失败时行已变），只展示扣款额 */
const buildDefaultInsufficientError = (balancePaidFen: number): Error =>
  new BadRequestException(
    clubPayError(
      CLUB_PAY_ERROR_CODE.RULE_BALANCE_INSUFFICIENT,
      `余额不足或已被并发消费，当前余额无法支付 ¥${Money.fromDbCents(balancePaidFen).toFixedOutputYuan()}`,
    ),
  );

/** 构造指标更新字段：等级阈值必须读门店配置，不能用硬编码兜底值 */
const buildMetricsUpdate = async (
  tx: Prisma.TransactionClient,
  storeId: number,
  metrics: DebitCustomerBalanceMetrics,
): Promise<Prisma.MarketingCustomerUpdateManyMutationInput> => {
  const thresholds = await queryCustomerTierThresholds(tx, storeId);
  const newTotalSpent = metrics.currentTotalSpent + metrics.settlementAmountFen;
  return {
    totalSpent: { increment: metrics.settlementAmountFen },
    visitCount: { increment: 1 },
    lastVisitAt: new Date(),
    tier: calcCustomerTier(newTotalSpent, thresholds) as never,
  };
};

/**
 * 原子扣减储值余额（事务内调用）。
 *
 * `balance: { gte }` 是最终防线：即使调用方前置校验通过，并发消费也可能让余额
 * 在事务内变化，只有条件更新能保证不会扣成负数。
 *
 * @throws 余额不足 / 档案已删除 / 并发失败时抛调用方指定的异常
 */
export async function debitCustomerBalance(
  tx: Prisma.TransactionClient,
  params: DebitCustomerBalanceParams,
): Promise<void> {
  const { customerId, storeId, balancePaidFen, metrics, requireActive } =
    params;

  const metricsUpdate = metrics
    ? await buildMetricsUpdate(tx, storeId, metrics)
    : {};

  const result = await tx.marketingCustomer.updateMany({
    where: {
      id: customerId,
      storeId,
      // 已软删档案不再参与扣款：宁可失败留待人工，也不能扣到失效档案上
      deletedAt: null,
      ...(requireActive ? { status: 'active' } : {}),
      balance: { gte: balancePaidFen },
    },
    data: {
      balance: { decrement: balancePaidFen },
      ...metricsUpdate,
    },
  });

  if (result.count !== 1) {
    throw (
      params.buildInsufficientError?.() ??
      buildDefaultInsufficientError(balancePaidFen)
    );
  }
}
