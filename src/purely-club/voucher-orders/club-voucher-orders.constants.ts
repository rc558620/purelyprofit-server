// 纯利宝团购券订单：错误文案常量

/** 商品不存在或已下架 */
export const CLUB_VOUCHER_PRODUCT_NOT_FOUND_MESSAGE = '商品不存在或已下架';

/** 商品不是团购券商品，不能走团购券下单 */
export const CLUB_VOUCHER_PRODUCT_NOT_VOUCHER_MESSAGE =
  '该商品不支持团购券购买';

/** 顾客档案不存在 */
export const CLUB_VOUCHER_CUSTOMER_NOT_FOUND_MESSAGE = '会员档案不存在';

/** 团购券订单不存在 */
export const CLUB_VOUCHER_ORDER_NOT_FOUND_MESSAGE = '团购券订单不存在';

/** 当前状态不允许核销 */
export const CLUB_VOUCHER_VERIFY_NOT_ALLOWED_MESSAGE = '当前订单状态不允许核销';

/** 团购券已过期（前端可能尚未触发惰性翻转，此处按 expiresAt 判定） */
export const CLUB_VOUCHER_VERIFY_EXPIRED_MESSAGE = '团购券已过期，无法核销';

/** 当前状态不允许退款 */
export const CLUB_VOUCHER_REFUND_NOT_ALLOWED_MESSAGE = '当前订单状态不允许退款';

/** 团购券已过期，不允许退款（与过期券不可核销保持同一语义） */
export const CLUB_VOUCHER_REFUND_EXPIRED_MESSAGE = '团购券已过期，无法退款';

/** 团购券已开台使用，禁止用户端退款 */
export const CLUB_VOUCHER_REFUND_USED_SESSION_MESSAGE =
  '该团购券已开台使用，无法退款';

/** 退款已受理但渠道尚未返回成功：不能再发起，也不能当成已退款 */
export const CLUB_VOUCHER_REFUND_PROCESSING_MESSAGE =
  '退款处理中，请稍后在订单记录查看';

/** 渠道明确退款失败（关闭 / 异常 / 无此退款单）：可重试 */
export const CLUB_VOUCHER_REFUND_FAILED_MESSAGE = '退款未成功，请稍后重试';

/** 渠道退款请求结果未知（网络 / 签名 / 5xx）：不能假设未退款 */
export const CLUB_VOUCHER_REFUND_UNKNOWN_MESSAGE =
  '退款结果未确认，请稍后重试；如重复扣款请联系客服';

/** 商品库存不足 */
export const CLUB_VOUCHER_STOCK_NOT_ENOUGH_MESSAGE = '商品库存不足';

/** 单次下单最大购买数量（数量为后续金额乘算因子，封顶避免越界） */
export const CLUB_VOUCHER_MAX_QUANTITY = 99;

/** 单次下单最大到店人数 */
export const CLUB_VOUCHER_MAX_PERSON_COUNT = 99;
