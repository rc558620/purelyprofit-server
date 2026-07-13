import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import type { ClubWechatPaymentParamsDto } from './dto/club-order.dto';
import type {
  ClubOrderPaymentChannelValue,
  ClubOrderPaymentConfirmationSourceValue,
  ClubOrderStatusValue,
  ClubOrderTypeValue,
} from './club-order.types';

export interface ClubRechargeOrderMetadata {
  packageId: string | null;
  promotionId: number | null;
  rechargeAmountFen: number;
  bonusAmountFen: number;
  customAmountFen: number | null;
}

export interface ClubServiceOrderMetadata {
  productId: number;
  productName: string;
  originalAmountFen: number;
  coverImage: string | null;
  /** 会员基准价（原价 × 等级折扣率，单位：分） */
  memberBaselineFen: number;
  promotionId: number | null;
  promotionType:
    | 'first_order_discount'
    | 'discount'
    | 'discount_day'
    | 'reduce'
    | null;
  discountRate: number | null;
  /** 总优惠金额 = 原价 - 最终价（不含积分抵扣，单位：分） */
  discountAmountFen: number;
  /** 折扣活动单独贡献的优惠金额（单位：分） */
  promotionDiscountAmountFen: number;
  /** 总满减减免金额（单位：分） */
  totalReduceFen: number;
  promotionTag: string | null;
  /** 积分抵扣金额（单位：分）；0 表示未使用积分 */
  pointsDeductFen: number;
  /** 实际消耗的积分数量 */
  pointsUsed: number;
  /** 购买数量；默认 1 */
  quantity: number;
}

export interface ClubOrderDraftPayload<
  TMetadata extends object = Record<string, unknown>,
  TOrderType extends ClubOrderTypeValue = ClubOrderTypeValue,
> {
  id: string;
  orderNo: string;
  orderType: TOrderType;
  status: ClubOrderStatusValue;
  storeId: number;
  storeName: string;
  userId: number;
  phone: string;
  customerId: number | null;
  title: string;
  amountFen: number;
  paymentChannel: ClubOrderPaymentChannelValue;
  createdAtMs: number;
  expiresAtMs: number;
  paidAtMs: number | null;
  paymentTransactionId: string | null;
  callbackReceivedAtMs: number | null;
  paymentConfirmationSource: ClubOrderPaymentConfirmationSourceValue | null;
  failureReason: string | null;
  paymentParams: ClubWechatPaymentParamsDto;
  metadata: TMetadata;
}

export interface ClubOrderPaidObservationOptions {
  paidAtMs?: number;
  paymentTransactionId?: string | null;
  callbackReceivedAtMs?: number | null;
  paymentConfirmationSource?: ClubOrderPaymentConfirmationSourceValue | null;
}

export interface CreateClubOrderDraftParams<
  TMetadata extends object,
  TOrderType extends ClubOrderTypeValue,
> {
  user: AuthenticatedUser;
  orderType: TOrderType;
  storeId: number;
  storeName: string;
  customerId: number | null;
  title: string;
  amountFen: number;
  metadata: TMetadata;
  now: number;
  /**
   * 外部预生成的订单号（与 JSAPI out_trade_no 保持一致）。
   * 不传时 createDraftPayload 自动生成。
   */
  orderNo?: string;
  /**
   * 外部注入的微信支付参数（真实 JSAPI 下单结果）。
   * 不传时 createDraftPayload 会生成 mock 参数（仅用于开发态）。
   */
  paymentParams?: ClubWechatPaymentParamsDto;
}
