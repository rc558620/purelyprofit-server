/** 商家端（purelyProfit）支付通道模式。 */
export type ProfitPaymentMode = 'test' | 'live';

/** 支付模式的合法取值列表，供 DTO 的 `@IsIn` 与归一化函数共用。 */
export const PROFIT_PAYMENT_MODES = ['test', 'live'] as const;

/** 运行期支付模式状态 key（仅非生产环境允许写入）。 */
export const PROFIT_PAYMENT_MODE_KEY = 'profit:payment-mode';

/**
 * 运行期支付模式状态 TTL（秒）：12 小时。
 *
 * 到期后自动回落为 `test`——不是回落成 live。真实模式意味着「真的会扣钱」，
 * 遗忘在这一侧的成本远高于重新点一次切换。
 */
export const PROFIT_PAYMENT_MODE_TTL_SECONDS = 12 * 60 * 60;

/** dev-only 支付模式开关接口的访问令牌请求头 */
export const PROFIT_PAYMENT_MODE_DEV_TOKEN_HEADER = 'x-payment-dev-token';
