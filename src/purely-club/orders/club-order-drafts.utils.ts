import { createHash, randomBytes } from 'node:crypto';
import Decimal from 'decimal.js';
import type {
  ClubOrderStatusResponseDto,
  ClubServiceOrderResponseDto,
  ClubWechatPaymentParamsDto,
} from './dto/club-order.dto';
import type {
  ClubOrderPaymentChannelValue,
  ClubOrderPaymentConfirmationSourceValue,
  ClubOrderTypeValue,
} from './club-order.types';
import type {
  ClubOrderDraftPayload,
  ClubOrderPaidObservationOptions,
  ClubServiceOrderMetadata,
  CreateClubOrderDraftParams,
} from './club-order-drafts.types';

const CLUB_ORDER_DRAFT_KEY_PREFIX = 'club:order:draft:';
export const CLUB_ORDER_DRAFT_TTL_SECONDS = 30 * 60;
const CLUB_ORDER_EXPIRE_MS = 15 * 60 * 1000;
const CLUB_ORDER_PAYMENT_CHANNEL: ClubOrderPaymentChannelValue = 'wechat';
const CLUB_ORDER_PAYMENT_SIGN_TYPE = 'RSA';

const pad = (value: number, width = 2): string =>
  String(value).padStart(width, '0');

const buildOrderNo = (orderType: ClubOrderTypeValue, now: number): string => {
  const date = new Date(now);
  const prefix = orderType === 'recharge' ? 'RC' : 'SV';
  const serial = [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
    pad(date.getMilliseconds(), 3),
    randomBytes(2).toString('hex').toUpperCase(),
  ].join('');

  return `${prefix}${serial}`;
};

const buildPaymentParams = (
  orderNo: string,
  now: number,
  amountFen: number,
): ClubWechatPaymentParamsDto => {
  const timeStamp = String(Math.floor(now / 1000));
  const nonceStr = randomBytes(12).toString('hex');
  const paymentPackage = `prepay_id=club_${orderNo}`;
  const paySign = createHash('sha256')
    .update(
      [
        orderNo,
        amountFen,
        timeStamp,
        nonceStr,
        paymentPackage,
        CLUB_ORDER_PAYMENT_SIGN_TYPE,
      ].join('|'),
    )
    .digest('hex')
    .toUpperCase();

  return {
    timeStamp,
    nonceStr,
    package: paymentPackage,
    signType: CLUB_ORDER_PAYMENT_SIGN_TYPE,
    paySign,
  };
};

export const createDraftPayload = <
  TMetadata extends object,
  TOrderType extends ClubOrderTypeValue,
>(
  params: CreateClubOrderDraftParams<TMetadata, TOrderType>,
): ClubOrderDraftPayload<TMetadata, TOrderType> => {
  const orderNo = buildOrderNo(params.orderType, params.now);

  return {
    id: orderNo,
    orderNo,
    orderType: params.orderType,
    status: 'pending',
    storeId: params.storeId,
    storeName: params.storeName,
    userId: params.user.id,
    phone: params.user.phone,
    customerId: params.customerId,
    title: params.title,
    amountFen: params.amountFen,
    paymentChannel: CLUB_ORDER_PAYMENT_CHANNEL,
    createdAtMs: params.now,
    expiresAtMs: params.now + CLUB_ORDER_EXPIRE_MS,
    paidAtMs: null,
    paymentTransactionId: null,
    callbackReceivedAtMs: null,
    paymentConfirmationSource: null,
    failureReason: null,
    paymentParams: buildPaymentParams(orderNo, params.now, params.amountFen),
    metadata: params.metadata,
  };
};

const resolvePaymentConfirmationSource = (
  currentSource: ClubOrderPaymentConfirmationSourceValue | null | undefined,
  nextSource: ClubOrderPaymentConfirmationSourceValue | null | undefined,
): ClubOrderPaymentConfirmationSourceValue | null => {
  if (nextSource === 'wechat_callback' || currentSource === 'wechat_callback') {
    return 'wechat_callback';
  }

  return nextSource ?? currentSource ?? null;
};

export const buildPaidDraft = <
  TMetadata extends object,
  TOrderType extends ClubOrderTypeValue,
>(
  draft: ClubOrderDraftPayload<TMetadata, TOrderType>,
  options?: ClubOrderPaidObservationOptions,
): ClubOrderDraftPayload<TMetadata, TOrderType> => ({
  ...draft,
  status: 'paid',
  paidAtMs: options?.paidAtMs ?? draft.paidAtMs ?? Date.now(),
  paymentTransactionId:
    options?.paymentTransactionId ?? draft.paymentTransactionId,
  callbackReceivedAtMs:
    options?.callbackReceivedAtMs ?? draft.callbackReceivedAtMs,
  paymentConfirmationSource: resolvePaymentConfirmationSource(
    draft.paymentConfirmationSource,
    options?.paymentConfirmationSource,
  ),
  failureReason: null,
});

export const normalizeDraft = <
  TMetadata extends object,
  TOrderType extends ClubOrderTypeValue,
>(
  draft: ClubOrderDraftPayload<TMetadata, TOrderType>,
): ClubOrderDraftPayload<TMetadata, TOrderType> => {
  const normalizedDraft: ClubOrderDraftPayload<TMetadata, TOrderType> = {
    ...draft,
    paymentTransactionId: draft.paymentTransactionId ?? null,
    callbackReceivedAtMs: draft.callbackReceivedAtMs ?? null,
    paymentConfirmationSource: draft.paymentConfirmationSource ?? null,
    failureReason: draft.failureReason ?? null,
  };

  if (
    normalizedDraft.status === 'pending' &&
    normalizedDraft.expiresAtMs <= Date.now()
  ) {
    return {
      ...normalizedDraft,
      status: 'expired',
      failureReason:
        normalizedDraft.failureReason ?? '订单超时未支付，已自动关闭',
    };
  }

  return normalizedDraft;
};

export const isSamePaidObservation = <
  TMetadata extends object,
  TOrderType extends ClubOrderTypeValue,
>(
  before: ClubOrderDraftPayload<TMetadata, TOrderType>,
  after: ClubOrderDraftPayload<TMetadata, TOrderType>,
): boolean =>
  before.status === after.status &&
  before.paidAtMs === after.paidAtMs &&
  before.paymentTransactionId === after.paymentTransactionId &&
  before.callbackReceivedAtMs === after.callbackReceivedAtMs &&
  before.paymentConfirmationSource === after.paymentConfirmationSource &&
  before.failureReason === after.failureReason;

const convertFenToYuan = (amountFen: number): number =>
  new Decimal(amountFen).div(100).toDecimalPlaces(2).toNumber();

const toIsoTime = (value: number | null): string | null =>
  value ? new Date(value).toISOString() : null;

const buildStatusReason = <
  TMetadata extends object,
  TOrderType extends ClubOrderTypeValue,
>(
  draft: ClubOrderDraftPayload<TMetadata, TOrderType>,
): string => {
  if (draft.failureReason?.trim()) {
    return draft.failureReason.trim();
  }

  if (draft.status === 'paid') {
    if (draft.paymentConfirmationSource === 'wechat_callback') {
      return '微信支付回调已确认并完成落账';
    }
    if (draft.paymentConfirmationSource === 'manual_confirm_paid') {
      return '开发态 confirm-paid 已兜底确认支付';
    }
    return '订单已支付';
  }

  if (draft.status === 'expired') {
    return '订单超时未支付，已自动关闭';
  }

  if (draft.status === 'cancelled') {
    return '订单已取消';
  }

  if (draft.status === 'failed') {
    return '订单支付失败';
  }

  return '待支付，等待微信支付结果';
};

export const toOrderStatusResponse = <
  TMetadata extends object,
  TOrderType extends ClubOrderTypeValue,
>(
  draft: ClubOrderDraftPayload<TMetadata, TOrderType>,
): ClubOrderStatusResponseDto => ({
  id: draft.id,
  orderNo: draft.orderNo,
  orderType: draft.orderType,
  title: draft.title,
  amount: convertFenToYuan(draft.amountFen),
  paymentChannel: draft.paymentChannel,
  status: draft.status,
  createdAt: new Date(draft.createdAtMs).toISOString(),
  expiresAt: new Date(draft.expiresAtMs).toISOString(),
  paidAt: toIsoTime(draft.paidAtMs),
  paymentTransactionId: draft.paymentTransactionId,
  callbackReceivedAt: toIsoTime(draft.callbackReceivedAtMs),
  paymentConfirmationSource: draft.paymentConfirmationSource,
  statusReason: buildStatusReason(draft),
});

export const toServiceOrderResponse = (
  draft: ClubOrderDraftPayload<ClubServiceOrderMetadata, 'service'>,
): ClubServiceOrderResponseDto => ({
  ...toOrderStatusResponse(draft),
  productId: String(draft.metadata.productId),
  productName: draft.metadata.productName,
  originalAmount: convertFenToYuan(draft.metadata.originalAmountFen),
  ...(draft.metadata.coverImage
    ? { coverImage: draft.metadata.coverImage }
    : {}),
  paymentParams: draft.paymentParams,
});

export const buildDraftKey = (orderId: string): string =>
  `${CLUB_ORDER_DRAFT_KEY_PREFIX}${orderId}`;
