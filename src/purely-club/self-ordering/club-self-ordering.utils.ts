import { randomBytes } from 'crypto';
import { ForbiddenException } from '@nestjs/common';

/**
 * 自助下单业态门禁：仅面向非餐饮（空间场景）门店。
 * 餐饮门店走既有扫码点餐链路，所有自助下单入口（扫码定位 / 菜单 / 建单）
 * 必须统一经过该校验，避免直接调用 API 绕过。
 */
export function assertGeneralStoreForSelfOrdering(store: {
  businessMode: string;
}): void {
  if (store.businessMode === 'catering') {
    throw new ForbiddenException('餐饮门店请使用扫码点餐');
  }
}

/**
 * 自助下单订单号前缀
 * 微信支付回调按订单号前缀路由（见 club-payment-callback-dispatch.service），
 * 与既有前缀并列：RC 充值 / SV 服务 / SO 扫码点餐 / VC 团购券 / SF 自助下单
 */
const SELF_ORDER_NO_PREFIX = 'SF';

/** 生成自助下单订单号：SF + 毫秒时间戳 + 6 位大写十六进制随机 */
export const createSelfOrderNo = (): string =>
  `${SELF_ORDER_NO_PREFIX}${Date.now()}${randomBytes(3).toString('hex').toUpperCase()}`;

/**
 * 生成商户支付单号：订单号 + 4 位随机后缀
 * 同一订单可能发起多次支付尝试（首次失败后重试），后缀保证微信侧 out_trade_no 不重复
 */
export const createMerchantPaymentNo = (orderNo: string): string =>
  `${orderNo}-${randomBytes(2).toString('hex').toUpperCase()}`;

/** 余额支付渠道标识；商户单号不使用订单号，避免与微信渠道在同一唯一索引下冲突 */
export const BALANCE_PAYMENT_CHANNEL = 'marketing_balance';
export const WECHAT_PAYMENT_CHANNEL = 'wechat_jsapi';

/** 空间账单商品行来源标识：区分会员自助下单与员工手工追加 */
export const SESSION_ITEM_SOURCE_TYPE = 'member_self_order';

/**
 * 请求指纹：写入幂等记录，用于识别同一 Idempotency-Key 下内容不一致的重复请求
 * 使用与扫码点餐同款的 djb2 变体，仅作一致性校验，不用于安全用途
 */
export const hashSelfOrderRequest = (payload: unknown): string => {
  const json = JSON.stringify(payload);
  let hash = 0;
  for (let index = 0; index < json.length; index += 1) {
    hash = (hash << 5) - hash + json.charCodeAt(index);
    hash |= 0;
  }
  return hash.toString(16);
};
