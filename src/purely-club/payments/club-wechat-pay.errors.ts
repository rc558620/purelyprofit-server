/**
 * 微信支付链路的业务错误码常量。
 *
 * 前端按 code 分支、不按文案匹配，因此 code 必须稳定；
 * 文案可在不通知前端的前提下调整。
 */

/** 门店未配置微信收款（mchId / apiV3Key 缺失） */
export const STORE_PAY_CONFIG_MISSING_CODE = 'STORE_PAY_CONFIG_MISSING';
export const STORE_PAY_CONFIG_MISSING_MESSAGE =
  '该门店暂不支持在线充值，请联系门店';
