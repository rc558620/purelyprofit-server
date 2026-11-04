/**
 * C 端购卡链路的常量与文案。
 *
 * 订单号前缀 `MC` 必须与 `club-payment-callback-dispatch.service.ts` 里的
 * 前缀映射表保持一致：回调按 out_trade_no 前缀路由，一处漏改就会让
 * 「钱已扣、卡未发」变成永久死信。
 */
import { Money } from '../../shared/money.utils';

export const CLUB_CARD_ORDER_NO_PREFIX = 'MC';

/** 待支付窗口（分钟）：与充值 / 团购券草稿同一口径，超时后前端引导重新下单 */
export const CLUB_CARD_PAY_WINDOW_MINUTES = 15;

/** 购卡下单的幂等作用域（与团购券 / 服务订单区分开） */
export const CLUB_CARD_ORDER_IDEMPOTENCY_SCOPE = 'club:card-order:create';

/** 卡包分页默认 / 上限条数 */
export const CLUB_CARD_LIST_DEFAULT_LIMIT = 20;
export const CLUB_CARD_LIST_MAX_LIMIT = 50;

/** 卡详情返回的使用记录条数上限（页面只展示最近若干条） */
export const CLUB_CARD_USAGE_RECORD_LIMIT = 50;

export const CLUB_CARD_PLAN_NOT_FOUND_MESSAGE = '会员卡模板不存在或已下架';
export const CLUB_CARD_NOT_FOUND_MESSAGE = '会员卡不存在';
export const CLUB_CARD_ORDER_NOT_FOUND_MESSAGE = '购卡订单不存在';
export const CLUB_CARD_CUSTOMER_NOT_FOUND_MESSAGE =
  '当前门店未找到你的会员档案，请先加入门店后再购卡';
export const CLUB_CARD_STORE_CHANGED_MESSAGE =
  '当前门店已切换，请刷新页面后重试';
export const CLUB_CARD_MANUAL_CONFIRM_DISABLED_MESSAGE =
  '当前环境未开启手动确认支付，请通过支付回调驱动落账';

/**
 * 余额不足提示（金额文案统一由后端拼装）。
 *
 * 下单前置校验与落账事务两处都要用同一句话：分别手写极易出现
 * 「下单提示需支付 199，落账提示需支付 199.00」这类前后不一致。
 */
export const buildCardBalanceInsufficientMessage = (
  balanceFen: number,
  amountFen: number,
): string =>
  `余额不足，当前余额 ¥${Money.fromDbCents(balanceFen).toFixedOutputYuan()}，需支付 ¥${Money.fromDbCents(amountFen).toFixedOutputYuan()}`;

/** 余额支付的订单流水号前缀：与微信 dev-/zero- 同口径，对账侧据此识别非微信渠道 */
export const buildClubCardBalanceTransactionId = (orderNo: string): string =>
  `balance-${orderNo}`;

/** 订单标题后缀：与 purelyClub 购卡页展示口径一致 */
export const CLUB_CARD_ORDER_TITLE_SUFFIX = ' · 会员卡购买';

/** 每人限购提示的前缀（实际文案在 service 内拼接剩余可购张数） */
export const CLUB_CARD_PURCHASE_LIMIT_MESSAGE_PREFIX = '该卡每人限购';
