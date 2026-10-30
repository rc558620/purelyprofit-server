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

/**
 * 回调验签所归属的资金链路，决定用哪一份微信平台证书公钥验签。
 *
 * - `club`：C 端门店微信收款（链路 a）。服务商模式开启时用**服务商商户号维度**的平台证书。
 * - `platform`：商家向平台付费（链路 b 短信钱包充值 / 链路 c 平台会员与新客额度），
 *   始终用全局那份平台证书（平台收款商户号维度）。
 *
 * 微信平台证书按商户号维度下发，两个维度不是同一份证书，必须按链路取用。
 */
export type WechatCallbackSignatureScope = 'club' | 'platform';

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
