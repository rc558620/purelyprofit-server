/**
 * C 端购卡链路视图拼装：数据库枚举 / 分金额 → 前端契约。
 *
 * 集中在一处的理由：卡包列表、卡详情、下单、查单四条链路都会用到
 * 「状态文案 / 剩余天数 / 使用记录类型」的换算，分散实现必然出现
 * 「列表显示次数用尽、详情显示 exhausted」这类脏展示。
 */
import type { MemberCardKind, MemberCardStatus } from '@prisma/client';
import { Money } from '../../shared/money.utils';
import type { ClubWechatPaymentParamsDto } from '../orders/dto/club-order.dto';
import {
  CLUB_CARD_ORDER_TITLE_SUFFIX,
  CLUB_CARD_PAY_WINDOW_MINUTES,
} from './club-cards.constants';
import type {
  ClubMemberCardOrderStatusValue,
  ClubMemberCardOrderView,
  ClubMemberCardPlanView,
  ClubMemberCardSnapshot,
  ClubMemberCardStatusValue,
  ClubMemberCardTransactionSnapshot,
  ClubMemberCardUsageRecordView,
  ClubMemberCardUsageTypeValue,
  ClubMemberCardView,
} from './club-cards.types';

/** 数据库持卡状态 → 前端状态（exhausted 在前端叫 usedUp） */
const CARD_STATUS_MAP: Record<MemberCardStatus, ClubMemberCardStatusValue> = {
  active: 'active',
  expired: 'expired',
  exhausted: 'usedUp',
  frozen: 'frozen',
  refunded: 'refunded',
};

/** 前端状态展示文案（后端直返，前端不再自行推导） */
const CARD_STATUS_TEXT_MAP: Record<ClubMemberCardStatusValue, string> = {
  active: '生效中',
  expired: '已过期',
  usedUp: '次数用尽',
  frozen: '已冻结',
  refunded: '已退款',
};

/** 售卡订单状态 → 前端订单状态（closed 与「待支付超时」同义） */
export const toOrderStatusValue = (
  status: string,
): ClubMemberCardOrderStatusValue => {
  switch (status) {
    case 'paid':
      return 'paid';
    case 'refunded':
      return 'refunded';
    case 'cancelled':
      return 'cancelled';
    case 'closed':
      return 'expired';
    // unpaid（待支付）与 pending（支付确认中）对用户都是「待支付」
    default:
      return 'pending';
  }
};

/** 卡模板（分 → 元 + 有效期文案） */
export const toPlanView = (params: {
  id: number;
  kind: MemberCardKind;
  name: string;
  price: number;
  originalPrice: number | null;
  validDays: number;
  totalTimes: number | null;
  storeName: string;
}): ClubMemberCardPlanView => {
  const priceYuan = Money.fromDbCents(params.price).toOutputYuan();
  const originalYuan =
    params.originalPrice === null
      ? undefined
      : Money.fromDbCents(params.originalPrice).toOutputYuan();

  return {
    id: String(params.id),
    kind: params.kind,
    name: params.name,
    price: priceYuan,
    // 划线价不高于售价时没有「优惠感」，直接不返回，避免前端划出虚假原价
    ...(originalYuan !== undefined && originalYuan > priceYuan
      ? { originalPrice: originalYuan }
      : {}),
    validDays: params.validDays,
    totalTimes: params.totalTimes,
    validityText: buildValidityText(
      params.kind,
      params.validDays,
      params.totalTimes,
    ),
    storeNames: [params.storeName],
  };
};

/** 有效期文案：次数卡强调「次数 + 兜底期限」，时长卡只讲天数 */
const buildValidityText = (
  kind: MemberCardKind,
  validDays: number,
  totalTimes: number | null,
): string => {
  if (kind !== 'times') {
    return `${validDays} 天`;
  }
  const times = totalTimes ?? 0;
  return `${times} 次 · ${validDays} 天内有效`;
};

/**
 * 持卡状态的读侧派生。
 *
 * 数据库侧没有「到期巡检」与「核销后置用尽」的写入路径，过期卡与次数用尽的卡
 * 会长期停在 active。若直接透传 DB 状态，卡包会出现
 * 「生效中 + 剩余 0 次」「生效中 + 已过有效期」这类自相矛盾的展示。
 *
 * 派生顺序与 purelyProfit 的 resolveMemberCardDisplayStatus 保持一致：
 * 次数用尽优先于过期（同一张卡只会给出一个最需要用户处理的状态）。
 */
const resolveStatusValue = (params: {
  status: MemberCardStatus;
  kind: MemberCardKind;
  expiresAt: Date | null;
  remainTimes: number | null;
  now: Date;
}): ClubMemberCardStatusValue => {
  const mapped = CARD_STATUS_MAP[params.status];
  if (mapped !== 'active') {
    return mapped;
  }
  if (params.kind === 'times' && (params.remainTimes ?? 0) <= 0) {
    return 'usedUp';
  }
  if (
    params.expiresAt !== null &&
    params.expiresAt.getTime() <= params.now.getTime()
  ) {
    return 'expired';
  }
  return 'active';
};

/** 剩余天数：次数卡与「不设到期」的卡返回 null（不适用 / 不限），否则按下限 0 截断 */
const resolveRemainDays = (params: {
  kind: MemberCardKind;
  expiresAt: Date | null;
  now: Date;
}): number | null => {
  if (params.kind === 'times' || params.expiresAt === null) {
    return null;
  }
  const millis = params.expiresAt.getTime() - params.now.getTime();
  if (millis <= 0) {
    return 0;
  }
  return Math.ceil(millis / (24 * 60 * 60 * 1000));
};

/** 持卡视图（卡包 / 卡详情共用） */
export const toCardView = (params: {
  card: ClubMemberCardSnapshot;
  storeName: string;
  /** 仅卡详情传入 */
  usageRecords?: ClubMemberCardUsageRecordView[];
  now?: Date;
}): ClubMemberCardView => {
  const { card } = params;
  const now = params.now ?? new Date();
  const status = resolveStatusValue({
    status: card.status,
    kind: card.kind,
    expiresAt: card.expiresAt,
    remainTimes: card.remainTimes,
    now,
  });

  return {
    id: String(card.id),
    cardNo: card.cardNo,
    planId: String(card.planId),
    planName: card.nameSnapshot,
    kind: card.kind,
    status,
    statusText: CARD_STATUS_TEXT_MAP[status],
    startAt: card.startsAt.toISOString(),
    // 特殊赠送卡不设到期（expiresAt = null）：如实返回 null，由前端展示「长期有效」。
    // 不能用生效时间兜底——那会让卡片显示「有效期至 办卡当天」且剩余 0 天，语义自相矛盾
    expireAt: card.expiresAt === null ? null : card.expiresAt.toISOString(),
    remainDays: resolveRemainDays({
      kind: card.kind,
      expiresAt: card.expiresAt,
      now,
    }),
    remainTimes: card.kind === 'times' ? (card.remainTimes ?? 0) : null,
    totalTimes: card.kind === 'times' ? card.totalTimes : null,
    // 卡实例归属于单一门店；多门店通用卡（跨店权益）当前模型不支持
    storeNames: [params.storeName],
    ...(params.usageRecords ? { usageRecords: params.usageRecords } : {}),
  };
};

/**
 * 使用记录类型：数据库变更类型收敛到前端展示类型。
 *
 * adjust / expire 必须单独成类：它们会被门店侧真实写入（手动调次）
 * 或未来由到期任务写入，混进 issue 会让卡详情出现
 * 「办卡」标签 + 「次数调整」描述这种自相矛盾的记录。
 */
export const toUsageTypeValue = (
  changeType: string,
): ClubMemberCardUsageTypeValue => {
  if (changeType === 'consume' || changeType === 'reserve') {
    return 'consume';
  }
  if (changeType === 'release') {
    return 'release';
  }
  if (changeType === 'adjust') {
    return 'adjust';
  }
  if (changeType === 'expire') {
    return 'expire';
  }
  // purchase / gift / refund：均为「卡内次数入账或回收」
  return 'issue';
};

/** 使用记录展示文案：台位名快照优先，其次销售单号，最后按变更类型兜底 */
const buildUsageDescription = (
  tx: ClubMemberCardTransactionSnapshot,
): string => {
  const suffix =
    tx.relatedSpaceNameSnapshot ??
    (tx.relatedSaleOrderNo ? `销售单 ${tx.relatedSaleOrderNo}` : null);

  switch (tx.changeType) {
    case 'reserve':
      return suffix ? `开台预扣 · ${suffix}` : '开台预扣';
    case 'consume':
      return suffix ? `开台核销 · ${suffix}` : '开台核销';
    case 'release':
      return suffix ? `取消开台释放 · ${suffix}` : '取消开台释放';
    case 'purchase':
      return tx.deltaTimes > 0
        ? `办卡开通 · 共 ${tx.deltaTimes} 次`
        : '办卡开通';
    case 'gift':
      return '赠送开卡';
    case 'refund':
      return '退款退卡';
    case 'expire':
      return '到期失效';
    default:
      return tx.remark ?? '次数调整';
  }
};

/** 使用记录视图 */
export const toUsageRecordView = (params: {
  tx: ClubMemberCardTransactionSnapshot;
  storeName: string;
}): ClubMemberCardUsageRecordView => ({
  id: String(params.tx.id),
  type: toUsageTypeValue(params.tx.changeType),
  description: buildUsageDescription(params.tx),
  changeTimes: params.tx.deltaTimes,
  remainTimesSnapshot: params.tx.afterTimes,
  createdAt: params.tx.createdAt.toISOString(),
  storeName: params.storeName,
});

/** 购卡订单视图（对齐前端 CardOrderResult） */
export const toOrderView = (params: {
  order: {
    orderNo: string;
    planId: number;
    planNameSnapshot: string;
    amount: number;
    paymentChannel: string | null;
    status: string;
    createdAt: Date;
    expiresAt: Date | null;
    paidAt: Date | null;
  };
  cardId: string | null;
  paymentParams?: ClubWechatPaymentParamsDto;
}): ClubMemberCardOrderView => {
  const { order } = params;
  // 待支付窗口兜底：历史单据可能没有 expires_at，用创建时间 + 15 分钟还原，
  // 避免前端拿到 null 后无法展示倒计时
  const expiresAt =
    order.expiresAt ??
    new Date(order.createdAt.getTime() + CLUB_CARD_PAY_WINDOW_MINUTES * 60_000);

  return {
    id: order.orderNo,
    orderNo: order.orderNo,
    orderType: 'card',
    title: `${order.planNameSnapshot}${CLUB_CARD_ORDER_TITLE_SUFFIX}`,
    amount: Money.fromDbCents(order.amount).toOutputYuan(),
    paymentChannel: order.paymentChannel ?? 'wechat',
    status: toOrderStatusValue(order.status),
    createdAt: order.createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    paidAt: order.paidAt ? order.paidAt.toISOString() : null,
    planId: String(order.planId),
    cardId: params.cardId,
    ...(params.paymentParams ? { paymentParams: params.paymentParams } : {}),
  };
};
