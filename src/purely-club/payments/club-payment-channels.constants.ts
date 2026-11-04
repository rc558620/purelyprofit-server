/**
 * 支付渠道 / 支付方式字面量的唯一来源。
 *
 * ⚠️ 取值分层是历史演进造成的，改动任何取值都属于「数据迁移 + 前端契约变更」，
 * 必须先取得确认后再动：
 * - 支付尝试表 / 扫码点餐订单（`scan_order_payment_attempt` / `scan_orders`）
 *   使用 `wechat_jsapi` / `marketing_balance`；
 * - 会员卡订单 / 团购券订单 / 通用订单草稿（`member_card_order` /
 *   `club_voucher_order` / `club_order_drafts`）使用 `wechat` / `balance`；
 * - 消费流水 `marketing_consumption.pay_type` 使用 `wechat` / `balance`。
 *
 * 本文件只收敛「定义」与「判定」，不改写历史值：任何跨模块的渠道判断都必须走
 * {@link isBalancePaymentChannel}，否则 `balance` 与 `marketing_balance`
 * 之间会漏单。
 */

/** 扫码点餐 / 自助点单支付尝试表中的微信 JSAPI 渠道值 */
export const CLUB_CHANNEL_WECHAT_JSAPI = 'wechat_jsapi';

/** 扫码点餐 / 自助点单支付尝试表中的余额渠道值 */
export const CLUB_CHANNEL_MARKETING_BALANCE = 'marketing_balance';

/** 会员卡 / 团购券 / 通用订单草稿 / 消费流水中的微信渠道值 */
export const CLUB_CHANNEL_WECHAT = 'wechat';

/** 会员卡 / 团购券 / 消费流水中的余额渠道值 */
export const CLUB_CHANNEL_BALANCE = 'balance';

/**
 * 是否余额支付渠道。
 *
 * 两种历史取值都必须命中：扫码 / 自助点单写 `marketing_balance`，
 * 购卡 / 团购券写 `balance`；只判一种会让跨模块对账与退款分支漏单。
 */
export const isBalancePaymentChannel = (
  channel: string | null | undefined,
): boolean =>
  channel === CLUB_CHANNEL_BALANCE ||
  channel === CLUB_CHANNEL_MARKETING_BALANCE;
