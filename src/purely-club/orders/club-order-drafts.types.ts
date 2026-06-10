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
}
