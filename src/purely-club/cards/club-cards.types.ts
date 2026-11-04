/**
 * C 端购卡链路对外视图类型。
 *
 * 字段口径以 purelyClub 的 `MemberCardPlan` / `MemberCard` /
 * `MemberCardUsageRecord` / `CardOrderResult` 契约为准：
 * 金额一律「元」（后端直返，前端不做换算），时间一律 ISO 字符串，
 * 数据库枚举 mapping 后返回前端枚举（如 exhausted → usedUp）。
 */
import type {
  MemberCardKind,
  MemberCardStatus,
  MemberCardTransactionStatus,
} from '@prisma/client';
import type { ClubWechatPaymentParamsDto } from '../orders/dto/club-order.dto';

/** 前端持卡状态枚举（数据库 exhausted 在前端叫 usedUp） */
export type ClubMemberCardStatusValue =
  | 'active'
  | 'expired'
  | 'usedUp'
  | 'frozen'
  | 'refunded';

/**
 * 卡包列表可筛选的状态值。
 *
 * 不含 refunded：已退款的卡不属于「我的卡包」，列表默认就把它排除，
 * 也不提供「已退款」筛选入口。类型与 DTO 校验必须共用本常量，避免「类型允许、校验拒绝」。
 */
export const CLUB_MEMBER_CARD_LIST_STATUS_VALUES = [
  'active',
  'expired',
  'usedUp',
  'frozen',
] as const;

export type ClubMemberCardListStatusValue =
  (typeof CLUB_MEMBER_CARD_LIST_STATUS_VALUES)[number];

/** 前端使用记录类型（数据库 8 种变更类型收敛到 5 种展示类型） */
export type ClubMemberCardUsageTypeValue =
  | 'issue'
  | 'consume'
  | 'release'
  | 'adjust'
  | 'expire';

/** 前端购卡订单状态枚举 */
export type ClubMemberCardOrderStatusValue =
  | 'pending'
  | 'paid'
  | 'refunded'
  | 'cancelled'
  | 'expired';

/**
 * 购卡支付方式。
 *
 * wechat=微信 JSAPI 支付（下单返回支付参数，由回调落账）；
 * balance=储值余额支付（下单同一请求内扣余额并直接发卡，不返回支付参数）。
 */
export const CLUB_CARD_PAYMENT_METHOD_VALUES = ['wechat', 'balance'] as const;

export type ClubCardPaymentMethod =
  (typeof CLUB_CARD_PAYMENT_METHOD_VALUES)[number];

/** 可购卡模板（购卡页档位卡） */
export interface ClubMemberCardPlanView {
  id: string;
  kind: MemberCardKind;
  name: string;
  /** 售价（元） */
  price: number;
  /** 划线价（元）；无划线价时不返回 */
  originalPrice?: number;
  validDays: number | null;
  totalTimes: number | null;
  /** 有效期展示文案（后端拼装，前端禁止按 validDays 推导） */
  validityText: string;
  /** 适用门店名称列表（当前卡模板为单门店，恒为当前门店） */
  storeNames: string[];
}

/** 可购卡列表响应（前端契约是 `{ items }`，不是裸数组） */
export interface ClubMemberCardPlanListView {
  items: ClubMemberCardPlanView[];
}

/** 会员卡使用记录 */
export interface ClubMemberCardUsageRecordView {
  id: string;
  type: ClubMemberCardUsageTypeValue;
  description: string;
  changeTimes: number;
  remainTimesSnapshot: number | null;
  createdAt: string;
  storeName?: string;
}

/** 用户持有的会员卡 */
export interface ClubMemberCardView {
  id: string;
  cardNo: string;
  planId: string;
  planName: string;
  kind: MemberCardKind;
  status: ClubMemberCardStatusValue;
  statusText: string;
  startAt: string;
  /** 到期时间；null 表示不设到期（长期有效），前端不得自行用生效时间兜底 */
  expireAt: string | null;
  remainDays: number | null;
  remainTimes: number | null;
  totalTimes: number | null;
  storeNames: string[];
  /** 仅卡详情返回 */
  usageRecords?: ClubMemberCardUsageRecordView[];
}

/** 卡包分页 */
export interface ClubMemberCardPageView {
  items: ClubMemberCardView[];
  nextCursor: string | null;
  total: number;
}

/** 购卡订单视图（对齐前端 CardOrderResult） */
export interface ClubMemberCardOrderView {
  id: string;
  orderNo: string;
  orderType: 'card';
  title: string;
  /** 应付金额（元） */
  amount: number;
  /** 支付渠道：wechat=微信支付 / balance=储值余额 / cash=线下现金 / gift=赠送 */
  paymentChannel: string;
  status: ClubMemberCardOrderStatusValue;
  createdAt: string;
  expiresAt: string;
  paidAt: string | null;
  planId: string;
  cardId: string | null;
  /** 微信支付参数；未解析到 openid 时不返回（前端不得伪造参数拉起支付） */
  paymentParams?: ClubWechatPaymentParamsDto;
}

/** 落账幂等闸门命中 / 完成后的统一结果（回调与手动确认共用） */
export interface ClubMemberCardSettlementResult {
  orderNo: string;
  orderType: 'card';
  status: 'paid';
  /** 本次是否真的新落账（false = 幂等命中，订单此前已支付） */
  settled: boolean;
  cardId: number | null;
}

/** 使用记录流水的最小投影（mapper 入参，避免依赖 Prisma 全量类型） */
export interface ClubMemberCardTransactionSnapshot {
  id: number;
  storeId: number;
  changeType: string;
  status: MemberCardTransactionStatus;
  deltaTimes: number;
  afterTimes: number | null;
  relatedSpaceNameSnapshot: string | null;
  relatedSaleOrderNo: string | null;
  remark: string | null;
  createdAt: Date;
}

/** 持卡记录的最小投影（mapper 入参） */
export interface ClubMemberCardSnapshot {
  id: number;
  storeId: number;
  planId: number;
  cardNo: string;
  kind: MemberCardKind;
  nameSnapshot: string;
  status: MemberCardStatus;
  startsAt: Date;
  expiresAt: Date | null;
  totalTimes: number | null;
  remainTimes: number | null;
  createdAt: Date;
}
