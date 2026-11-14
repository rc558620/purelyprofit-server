import { CLUB_PAY_ERROR_CODE, clubPayError } from './club-pay.errors';
import { BadRequestException } from '@nestjs/common';
import type { ClubOrderPaidObservationOptions } from '../orders/club-order-drafts.types';

/** 订单 / 回调金额为 0 或负数：微信回调链路上一定属于异常数据 */
const WECHAT_AMOUNT_INVALID_MESSAGE =
  '订单金额或回调金额异常（不能为 0 或负数）';

/** 内部落账链路允许 0 元订单，但负数仍是异常 */
const ZERO_AMOUNT_INVALID_MESSAGE = '订单金额或回调金额异常（不能为负数）';

const AMOUNT_MISMATCH_MESSAGE = '回调金额与订单金额不一致';

/**
 * 金额一致性校验（严格版）：真实微信回调链路专用。
 *
 * 所有落账链路（充值 / 服务订单 / 扫码点餐 / 自助点单 / 团购券 / 购卡）都只允许走这里：
 * 此前各链路自写比较与文案，同一笔「金额不一致」在不同业务线表现不同，
 * 告警与对账时无法按统一口径检索。
 *
 * 0 元在微信侧不可能成交，因此严格版把 0 与负数一并视为异常。
 */
export function assertClubPaymentAmountMatches(
  expectedAmountFen: number,
  callbackAmountFen: number,
): void {
  if (expectedAmountFen <= 0 || callbackAmountFen <= 0) {
    throw new BadRequestException(
      clubPayError(
        CLUB_PAY_ERROR_CODE.PARAM_AMOUNT_NON_POSITIVE,
        WECHAT_AMOUNT_INVALID_MESSAGE,
      ),
    );
  }

  if (expectedAmountFen !== callbackAmountFen) {
    throw new BadRequestException(
      clubPayError(
        CLUB_PAY_ERROR_CODE.RULE_AMOUNT_MISMATCH,
        AMOUNT_MISMATCH_MESSAGE,
      ),
    );
  }
}

/**
 * 金额一致性校验（允许 0 元）：内部落账链路专用。
 *
 * 0 元订单是合法业务场景——全额积分抵扣、免费团购券、零元卡都不经过微信收银台，
 * 由内部 confirm-paid 或建单同请求直接落账。这类链路必须允许「双方都为 0」，
 * 否则免费订单永远无法完成；但只要任一方 > 0，仍然必须严格相等。
 */
export function assertClubPaymentAmountMatchesAllowZero(
  expectedAmountFen: number,
  callbackAmountFen: number,
): void {
  if (expectedAmountFen < 0 || callbackAmountFen < 0) {
    throw new BadRequestException(
      clubPayError(
        CLUB_PAY_ERROR_CODE.PARAM_AMOUNT_NEGATIVE,
        ZERO_AMOUNT_INVALID_MESSAGE,
      ),
    );
  }

  if (expectedAmountFen !== callbackAmountFen) {
    throw new BadRequestException(
      clubPayError(
        CLUB_PAY_ERROR_CODE.RULE_AMOUNT_MISMATCH,
        AMOUNT_MISMATCH_MESSAGE,
      ),
    );
  }
}

/**
 * 多个本地金额都必须与回调金额一致（严格版）。
 *
 * 用于事务内二次校验：并发改价后「支付流水金额」与「订单应付金额」必须同时匹配回调，
 * 只校验其中一个会留下「按流水落账、按订单出餐」的口径裂缝。
 */
export function assertClubPaymentAmountsMatch(
  callbackAmountFen: number,
  expectedAmountsFen: readonly number[],
): void {
  for (const expectedAmountFen of expectedAmountsFen) {
    assertClubPaymentAmountMatches(expectedAmountFen, callbackAmountFen);
  }
}

/** 多个本地金额都必须与回调金额一致（允许 0 元，供内部落账链路使用） */
export function assertClubPaymentAmountsMatchAllowZero(
  callbackAmountFen: number,
  expectedAmountsFen: readonly number[],
): void {
  for (const expectedAmountFen of expectedAmountsFen) {
    assertClubPaymentAmountMatchesAllowZero(
      expectedAmountFen,
      callbackAmountFen,
    );
  }
}

export function shouldRefreshPaidObservation(
  paymentMeta?: ClubOrderPaidObservationOptions,
): boolean {
  return (
    paymentMeta?.paymentConfirmationSource === 'wechat_callback' ||
    paymentMeta?.paymentTransactionId != null ||
    paymentMeta?.callbackReceivedAtMs != null
  );
}
