import { BadRequestException } from '@nestjs/common';
import type { ClubOrderPaidObservationOptions } from '../orders/club-order-drafts.types';

export function assertClubPaymentAmountMatches(
  expectedAmountFen: number,
  callbackAmountFen: number,
): void {
  if (expectedAmountFen !== callbackAmountFen) {
    throw new BadRequestException('回调金额与订单金额不一致');
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
