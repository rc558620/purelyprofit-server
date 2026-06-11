import type {
  ClubOrderStatusValue,
  ClubOrderTypeValue,
} from '../orders/club-order.types';

export interface ClubWechatCallbackHeaders {
  timestamp: string | undefined;
  nonce: string | undefined;
  signature: string | undefined;
}

export interface ClubPaymentCallbackSettlementParams {
  amountFen: number;
  transactionId: string;
  paidAtMs: number;
  callbackReceivedAtMs: number;
}

export interface ClubPaymentCallbackResult {
  orderNo: string;
  orderType: ClubOrderTypeValue;
  status: ClubOrderStatusValue;
}
