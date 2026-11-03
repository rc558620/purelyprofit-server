// 持卡实例 / 核销流水领域常量：枚举取值即接口契约，DTO / service / 映射层统一引用这里
// 与 Prisma 枚举（cards.prisma）保持一一对应，禁止在业务代码里散写字符串字面量。
import {
  MEMBER_CARD_KIND_VALUES,
  MEMBER_CARD_TIMES_KIND,
  type MemberCardKindValue,
} from './member-card-plan.constants';

export { MEMBER_CARD_KIND_VALUES, MEMBER_CARD_TIMES_KIND };
export type { MemberCardKindValue };

/** 持卡状态：与 purelyProfit 前端 MemberCardStatus 一一对应 */
export const MEMBER_CARD_STATUS_VALUES = [
  'active',
  'expired',
  'exhausted',
  'frozen',
  'refunded',
] as const;

export type MemberCardStatusValue = (typeof MEMBER_CARD_STATUS_VALUES)[number];

/**
 * 允许手动增减次数的状态：生效中，以及次数用尽（加次数后应恢复生效）。
 * 冻结 / 已退款属于资金与合规处置态，走业务后台而不是收银台调次。
 */
export const MEMBER_CARD_ADJUSTABLE_STATUS_VALUES: readonly MemberCardStatusValue[] =
  ['active', 'exhausted'];

/** 持卡来源：C 端下单 / 员工办卡（历史数据） / 赠送 / 历史迁移 */
export const MEMBER_CARD_SOURCE_TYPE_VALUES = [
  'club_order',
  'staff_issue',
  'gift',
  'migration',
] as const;

export type MemberCardSourceTypeValue =
  (typeof MEMBER_CARD_SOURCE_TYPE_VALUES)[number];

/** 流水变更类型 */
export const MEMBER_CARD_CHANGE_TYPE_VALUES = [
  'reserve',
  'consume',
  'release',
  'purchase',
  'refund',
  'expire',
  'adjust',
  'gift',
] as const;

export type MemberCardChangeTypeValue =
  (typeof MEMBER_CARD_CHANGE_TYPE_VALUES)[number];

/** 流水状态：仅 reserve 会停留在 pending */
export const MEMBER_CARD_TRANSACTION_STATUS_VALUES = [
  'pending',
  'done',
  'cancelled',
] as const;

export type MemberCardTransactionStatusValue =
  (typeof MEMBER_CARD_TRANSACTION_STATUS_VALUES)[number];

/** 流水操作来源：C 端自助 / 收银台 / 系统任务 */
export const MEMBER_CARD_OPERATOR_TYPE_VALUES = [
  'club',
  'cashier',
  'system',
] as const;

export type MemberCardOperatorTypeValue =
  (typeof MEMBER_CARD_OPERATOR_TYPE_VALUES)[number];

/** 售卡订单状态：与 Prisma MemberCardOrderStatus / 前端 MemberCardOrderStatus 一一对应 */
export const MEMBER_CARD_ORDER_STATUS_VALUES = [
  'unpaid',
  'pending',
  'paid',
  'refunded',
  'cancelled',
  'closed',
] as const;

export type MemberCardOrderStatusValue =
  (typeof MEMBER_CARD_ORDER_STATUS_VALUES)[number];

/** 售卡订单来源渠道：C 端微信 / 线下现金 / 线下微信 / 赠送 */
export const MEMBER_CARD_ORDER_SOURCE_VALUES = [
  'club_wechat',
  'staff_cash',
  'staff_wechat',
  'gift',
] as const;

export type MemberCardOrderSourceValue =
  (typeof MEMBER_CARD_ORDER_SOURCE_VALUES)[number];

/**
 * 可筛选的售卡订单来源。
 *
 * 线下办卡（收银台现金 / 线下微信）能力已下线，不再产生新单据，前端也不再提供该筛选维度；
 * 历史单据仍需在列表里展示来源标签，因此只收紧可筛集合，不删除来源枚举本身。
 */
export const MEMBER_CARD_ORDER_FILTERABLE_SOURCE_VALUES: readonly MemberCardOrderSourceValue[] =
  ['club_wechat', 'gift'];

/** 手动调次的单次绝对值上限：与卡模板次数上限一致，挡住明显误操作 */
export const MEMBER_CARD_ADJUST_TIMES_MAX = 9999;

/** 办卡 / 调次备注长度上限 */
export const MEMBER_CARD_REMARK_MAX_LENGTH = 200;

/** 持卡列表关键字长度上限（顾客姓名 / 手机号 / 卡号 / 卡名） */
export const MEMBER_CARD_KEYWORD_MAX_LENGTH = 30;

/** 关键字匹配顾客时最多参与的顾客数，避免 IN 列表无限膨胀 */
export const MEMBER_CARD_CUSTOMER_SEARCH_LIMIT = 200;

/** 手机号原始输入长度上限：允许 +86 / 空格写法，由服务层统一归一化后再匹配 */
export const MEMBER_CARD_IDENTIFY_PHONE_MAX_LENGTH = 20;

/** 开台识别：只有「已支付待使用」的团购券算可用，已核销 / 已退款 / 已过期一律不下发 */
export const MEMBER_CARD_IDENTIFY_USABLE_VOUCHER_STATUSES = [
  'pending',
] as const;

/**
 * 开台识别单次最多返回的可用持卡 / 团购券条数。
 * 识别结果直接进收银台下拉，顾客历史资产再多也不允许无上限下发。
 */
export const MEMBER_CARD_IDENTIFY_CARDS_LIMIT = 50;
export const MEMBER_CARD_IDENTIFY_VOUCHERS_LIMIT = 50;

/** 毫秒日长：剩余天数 / 到期时间计算唯一口径 */
export const MEMBER_CARD_DAY_MS = 86_400_000;
