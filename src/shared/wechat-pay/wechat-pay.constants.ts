/**
 * 微信支付 API v3 传输层常量（平台侧 / 门店侧共用）。
 *
 * 单独成文件的原因：这些值决定「请求多久算超时」「证书多久热更新一次」
 * 「私钥缺失时下发什么签名」，属于资金链路的稳定口径，
 * 不应随某个 service 的职责调整而搬迁。
 */

/** 微信支付 API v3 基址 */
export const WECHAT_PAY_API_BASE = 'https://api.mch.weixin.qq.com';

/**
 * 微信 API 请求超时（毫秒）。
 *
 * 微信侧挂起时若不设上限，下单 / 关单会无限等待，把 Node 事件循环里的连接
 * 和上层请求一起拖住；框架层的 requestTimeout 只断客户端，不会中断 fetch。
 */
export const WECHAT_PAY_REQUEST_TIMEOUT_MS = 8000;

/** 私钥缓存有效期：5 分钟，支持证书热更新而不必重启进程 */
export const WECHAT_PAY_PRIVATE_KEY_CACHE_TTL_MS = 5 * 60 * 1000;

/** 未配置私钥时的占位签名：请求会被微信拒绝，但不会让本地链路崩溃 */
export const WECHAT_PAY_DEV_PLACEHOLDER_SIGNATURE = 'DEV_MODE_NO_RSA_KEY';
