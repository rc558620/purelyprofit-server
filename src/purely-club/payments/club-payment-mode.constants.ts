/**
 * 支付通道模式。
 * - `test`：测试模式，允许跳过微信真实扣款、由前端 / 兜底接口直接确认支付
 * - `live`：真实模式，必须走微信支付并由回调驱动落账
 */
export type ClubPaymentMode = 'test' | 'live';

/** 支付模式的合法取值列表，供 DTO 的 `@IsIn` 与归一化函数共用。 */
export const CLUB_PAYMENT_MODES = ['test', 'live'] as const;

/** 运行期支付模式状态 key（仅非生产环境允许写入）。 */
export const CLUB_PAYMENT_MODE_KEY = 'club:payment-mode';

/**
 * 运行期支付模式状态 TTL（秒）：12 小时。
 *
 * 避免开发者切到 live 后长期遗忘，造成「本以为在测试、实际在真实扣款」的资金事故；
 * TTL 到期后读者看到的仍是 key 不存在，回落为**配置默认模式**
 * （`club.manualConfirmPaidEnabled` 推导；生产环境恒为 live）。
 * 注意：回落方向跟随配置默认值，不一定是 test，不能用「TTL 到期就安全」来推理。
 */
export const CLUB_PAYMENT_MODE_TTL_SECONDS = 12 * 60 * 60;

/**
 * dev-only 支付模式开关接口的访问令牌请求头。
 * 令牌本身只存在服务端配置里，前端通过构建期注入的同值令牌携带。
 */
export const CLUB_PAYMENT_MODE_DEV_TOKEN_HEADER = 'x-payment-dev-token';
