import type { ClubPaymentCallbackSettlementParams } from '../purely-club/payments/club-payments.types';

/** 微信支付成功回调异步任务数据。 */
export interface ClubPaymentCallbackJobData {
  orderNo: string;
  settlementParams: ClubPaymentCallbackSettlementParams;
}
