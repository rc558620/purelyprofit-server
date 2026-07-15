import { createHash, randomBytes } from 'node:crypto';
import Decimal from 'decimal.js';
import { Money } from '../../shared/money.utils';
import { DEFAULT_MARKETING_MEMBER_LEVEL_SETTINGS } from '../../purely-profit/marketing/marketing.utils';
import { safeParsePointsRatio } from '../../purely-profit/marketing/schemas/member-level-settings.schema';
import type { Prisma } from '@prisma/client';
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
export const CLUB_ORDER_DRAFT_TTL_SECONDS = 2 * 60 * 60;
const CLUB_ORDER_EXPIRE_MS = 15 * 60 * 1000;
const CLUB_ORDER_PAYMENT_CHANNEL: ClubOrderPaymentChannelValue = 'wechat';
const CLUB_ORDER_PAYMENT_SIGN_TYPE = 'RSA';

const pad = (value: number, width = 2): string =>
  String(value).padStart(width, '0');

export const buildOrderNo = (
  orderType: ClubOrderTypeValue,
  now: number,
): string => {
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
  // 优先使用外部预生成的订单号（需与 JSAPI out_trade_no 保持一致）
  const orderNo = params.orderNo ?? buildOrderNo(params.orderType, params.now);

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
    // 优先使用外部传入的真实 JSAPI 参数；未传时生成 mock 参数（开发态兜底）
    paymentParams:
      params.paymentParams ??
      buildPaymentParams(orderNo, params.now, params.amountFen),
    metadata: params.metadata,
  };
};

/**
 * 合并支付确认来源（paymentConfirmationSource）
 *
 * 优先级规则：wechat_callback > manual_confirm_paid > null
 * - 若任一方为 wechat_callback，结果一定是 wechat_callback（真实回调优先级最高）
 * - 否则取 nextSource → currentSource 的瀑布式回退
 *
 * @param currentSource - 草稿当前存储的确认来源
 * @param nextSource    - 本次观察到的确认来源（如回调、手动确认）
 */
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
  // 保留已有值，仅在原值为空时用新值补充，防止重复回调覆盖精确数据
  paidAtMs: draft.paidAtMs ?? options?.paidAtMs ?? Date.now(),
  paymentTransactionId:
    draft.paymentTransactionId ?? options?.paymentTransactionId ?? null,
  callbackReceivedAtMs:
    draft.callbackReceivedAtMs ?? options?.callbackReceivedAtMs ?? null,
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
  amount: Money.fromDbCents(draft.amountFen).toOutputYuan(),
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
  originalAmount: Money.fromDbCents(draft.metadata.originalAmountFen).toOutputYuan(),
  discountAmount: Money.fromDbCents(draft.metadata.discountAmountFen).toOutputYuan(),
  promotionId: draft.metadata.promotionId
    ? String(draft.metadata.promotionId)
    : null,
  promotionType: draft.metadata.promotionType,
  discountRate: draft.metadata.discountRate,
  promotionTag: draft.metadata.promotionTag,
  ...(draft.metadata.coverImage
    ? { coverImage: draft.metadata.coverImage }
    : {}),
  paymentParams: draft.paymentParams,
});

export const buildDraftKey = (orderId: string): string =>
  `${CLUB_ORDER_DRAFT_KEY_PREFIX}${orderId}`;

// ─── 公共积分配置解析 ──────────────────────────────────────────────────

/** 可用于查询积分配置的 Prisma 客户端（PrismaService 或事务客户端） */
export type PointsConfigPrismaClient = Prisma.TransactionClient;

/** 积分抵扣配置（创建订单时使用） */
export interface ClubPointsRedeemConfig {
  redeemRatioPoints: number;
  maxRedeemRatio: number;
  enabled: boolean;
}

/** 积分获得配置（结算时使用） */
export interface ClubPointsEarnConfig {
  earnRatioCents: number;
  enabled: boolean;
}

/**
 * 从 marketingMemberLevelSetting.pointsRatio JSON 中解析积分抵扣配置
 * 统一提取到 utils，避免 creation / settlement 各自重复实现
 */
export function resolvePointsRedeemConfig(
  pointsRatio: unknown,
): ClubPointsRedeemConfig {
  const fallback = DEFAULT_MARKETING_MEMBER_LEVEL_SETTINGS.pointsRatio;
  const parsed = safeParsePointsRatio(pointsRatio);

  if (parsed) {
    return {
      redeemRatioPoints: parsed.redeemRatioPoints,
      maxRedeemRatio: parsed.maxRedeemRatio,
      enabled: parsed.enabled,
    };
  }

  return {
    redeemRatioPoints: fallback.redeemRatioPoints,
    maxRedeemRatio: fallback.maxRedeemRatio,
    enabled: fallback.enabled,
  };
}

/**
 * 从 marketingMemberLevelSetting.pointsRatio JSON 中解析积分获得配置
 * 统一提取到 utils，避免 creation / settlement 各自重复实现
 */
export function resolvePointsEarnConfig(
  pointsRatio: unknown,
): ClubPointsEarnConfig {
  const fallback = DEFAULT_MARKETING_MEMBER_LEVEL_SETTINGS.pointsRatio;
  const parsed = safeParsePointsRatio(pointsRatio);

  if (parsed) {
    return {
      earnRatioCents: parsed.earnRatioCents,
      enabled: parsed.enabled,
    };
  }

  return {
    earnRatioCents: fallback.earnRatioCents,
    enabled: fallback.enabled,
  };
}

/**
 * 查询门店积分抵扣配置（含活动覆盖逻辑）
 *
 * 从 marketingMemberLevelSetting 中读取配置，若 enabled=false 但存在
 * 活跃的 points_recharge 活动，则强制 enabled=true。
 * 供 preview / creation / member service 复用（BUG-7 DRY 提取）。
 *
 * ⚠️ 设计决策：返回的 enabled 字段仅用于：
 *   1. 后台管理页展示积分功能开关状态
 *   2. settlement 中「赚取积分」逻辑（awardConsumptionPoints）
 *   调用方（preview / creation）在「抵扣积分」时应忽略 enabled，
 *   只取 redeemRatioPoints / maxRedeemRatio 进行计算。
 */
export async function fetchPointsRedeemConfig(
  prisma: PointsConfigPrismaClient,
  storeId: number,
): Promise<ClubPointsRedeemConfig> {
  const settings = await prisma.marketingMemberLevelSetting.findUnique({
    where: { storeId },
    select: { pointsRatio: true },
  });

  const config = resolvePointsRedeemConfig(settings?.pointsRatio);

  if (!config.enabled) {
    const now = new Date();
    const promo = await prisma.marketingPromotion.findFirst({
      where: {
        storeId,
        type: 'points_recharge',
        enabled: true,
        startAt: { lte: now },
        endAt: { gte: now },
      },
      select: { id: true },
    });
    if (promo) {
      return { ...config, enabled: true };
    }
  }

  return config;
}

/**
 * 查询门店积分获得配置（含活动覆盖逻辑）
 *
 * 与 fetchPointsRedeemConfig 对称，供 settlement service 复用。
 *
 * ⚠️ 设计决策区分「赚取」与「抵扣」：
 *   - enabled 控制「赚取积分」（settlement.awardConsumptionPoints），未启用时不赠送。
 *   - enabled 不控制「抵扣积分」（creation.calcPointsDeduction），用户有积分即可抵扣。
 *   禁止将 enabled 检查逻辑复制到抵扣路径。
 */
export async function fetchPointsEarnConfig(
  prisma: PointsConfigPrismaClient,
  storeId: number,
): Promise<ClubPointsEarnConfig> {
  const settings = await prisma.marketingMemberLevelSetting.findUnique({
    where: { storeId },
    select: { pointsRatio: true },
  });

  const config = resolvePointsEarnConfig(settings?.pointsRatio);

  if (!config.enabled) {
    const now = new Date();
    const promo = await prisma.marketingPromotion.findFirst({
      where: {
        storeId,
        type: 'points_recharge',
        enabled: true,
        startAt: { lte: now },
        endAt: { gte: now },
      },
      select: { id: true },
    });
    if (promo) {
      return { ...config, enabled: true };
    }
  }

  return config;
}
