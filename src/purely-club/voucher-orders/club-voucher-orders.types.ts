// 纯利宝团购券订单：领域类型与状态常量

/** 团购券订单状态：unpaid=未支付 pending=待使用 used=已使用 refunded=已退款 expired=已过期 */
export const CLUB_VOUCHER_ORDER_STATUS_VALUES = [
  'unpaid',
  'pending',
  'used',
  'refunded',
  'expired',
] as const;
export type ClubVoucherOrderStatusValue =
  (typeof CLUB_VOUCHER_ORDER_STATUS_VALUES)[number];

/** 团购券订单支付渠道（当前仅微信，余额渠道预留） */
export const CLUB_VOUCHER_ORDER_PAYMENT_CHANNEL_VALUES = ['wechat'] as const;
export type ClubVoucherOrderPaymentChannelValue =
  (typeof CLUB_VOUCHER_ORDER_PAYMENT_CHANNEL_VALUES)[number];

/** 团购平台：当前固定纯利宝 */
export const CLUB_VOUCHER_PLATFORM = 'chunlibao' as const;

/** 团购券业务订单号前缀（微信 out_trade_no，回调按前缀路由） */
export const CLUB_VOUCHER_ORDER_NO_PREFIX = 'VC' as const;

/** 团购券默认有效天数（商品未配置 validDays 时） */
export const CLUB_VOUCHER_DEFAULT_VALID_DAYS = 7 as const;

/** 顾客类型（当前统一会员） */
export const CLUB_VOUCHER_GUEST_TYPE = 'member' as const;
