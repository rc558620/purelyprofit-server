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
import { Money } from '../../shared/money.utils';
import { applyCustomerMetrics } from '../shared/club-customer-metrics.helper';

/** 与扣款同事务更新的顾客消费指标 */
export interface DebitCustomerBalanceMetrics {
  /**
   * 计入累计消费的金额（分）。
   *
   * 通常 = 扣款额 + 积分抵扣额，必须与消费流水 `amount` 同口径，
   * 否则物化字段会永远小于「流水实时聚合」。
   */
  settlementAmountFen: number;
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
  /**
   * 事务外预加载的等级阈值；传入则不再在事务内查配置。
   * 不传时行为不变（事务内读取），供其余结算链路继续使用。
   */
  tierThresholds?: { gold: number; diamond: number };
}

/** 统一兜底文案：无法回读最新余额（并发失败时行已变），只展示扣款额 */
const buildDefaultInsufficientError = (balancePaidFen: number): Error =>
  new BadRequestException(
    clubPayError(
      CLUB_PAY_ERROR_CODE.RULE_BALANCE_INSUFFICIENT,
      `余额不足或已被并发消费，当前余额无法支付 ¥${Money.fromDbCents(balancePaidFen).toFixedOutputYuan()}`,
    ),
  );

/**
 * 原子扣减储值余额（事务内调用）。
 *
 * `balance >= 扣款额` 作为 SQL 条件写进同一条 UPDATE，是最终防线：即使调用方
 * 前置校验通过，并发消费也可能让余额在事务内变化，只有条件更新能保证不会扣成负数。
 * 累计消费 / 到店次数 / 等级由 {@link applyCustomerMetrics} 在同一语句内原子更新，
 * 等级基于数据库更新后的真实 totalSpent 重算，不再使用调用方读到的旧值。
 *
 * @throws 余额不足 / 档案已删除 / 并发失败时抛调用方指定的异常
 */
export async function debitCustomerBalance(
  tx: Prisma.TransactionClient,
  params: DebitCustomerBalanceParams,
): Promise<void> {
  const {
    customerId,
    storeId,
    balancePaidFen,
    metrics,
    requireActive,
    tierThresholds,
  } = params;

  const snapshot = await applyCustomerMetrics(tx, {
    customerId,
    storeId,
    balanceDelta: -balancePaidFen,
    requireBalanceGte: balancePaidFen,
    totalSpentDelta: metrics?.settlementAmountFen ?? 0,
    visitCountDelta: metrics ? 1 : 0,
    touchLastVisitAt: Boolean(metrics),
    requireActive,
    tierThresholds,
  });

  if (!snapshot) {
    throw (
      params.buildInsufficientError?.() ??
      buildDefaultInsufficientError(balancePaidFen)
    );
  }
}
