import type {
  ClubOrderStatusValue,
  ClubOrderTypeValue,
} from '../orders/club-order.types';

export interface ClubWechatCallbackHeaders {
  timestamp: string | undefined;
  nonce: string | undefined;
  signature: string | undefined;
  serial: string | undefined;
}

export interface ClubPaymentCallbackSettlementParams {
  amountFen: number;
  transactionId: string;
  paidAtMs: number;
  callbackReceivedAtMs: number;
}

export interface ClubPaymentCallbackResult {
  orderNo: string;
  /** self_ordering 为空间自助下单（SF 前缀），支付成功后订单直接置为 paid（无需商家接单） */
  orderType: ClubOrderTypeValue | 'scan_ordering' | 'voucher' | 'self_ordering';
  status:
    | ClubOrderStatusValue
    | 'pending_acceptance'
    | 'unpaid'
    | 'used'
    | 'refunded';
}
