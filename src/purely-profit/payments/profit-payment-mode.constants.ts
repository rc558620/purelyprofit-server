/** 商家端（purelyProfit）支付通道模式。 */
export type ProfitPaymentMode = 'test' | 'live';

/** 支付模式的合法取值列表，供 DTO 的 `@IsIn` 与归一化函数共用。 */
export const PROFIT_PAYMENT_MODES = ['test', 'live'] as const;

/** 运行期支付模式状态 key（仅非生产环境允许写入）。 */
export const PROFIT_PAYMENT_MODE_KEY = 'profit:payment-mode';

/**
 * 运行期支付模式状态 TTL（秒）：12 小时。
 *
 * 到期后回落为**配置默认模式**（`profit.manualPaidEnabled` 决定的 test / live），
 * 而不是固定回落到某一侧。注意商家端与 club 侧方向相反：
 * - 商家端「非 test 即 live」，配置未打开时回落为 live；
 * - 真实模式意味着「真的会扣钱」，遗忘在这一侧的成本远高于重新点一次切换；
 * - 反过来若固定回落 test，会从「忘了切回去」进一步演变成白送会员权益与额度。
 */
export const PROFIT_PAYMENT_MODE_TTL_SECONDS = 12 * 60 * 60;

/** dev-only 支付模式开关接口的访问令牌请求头 */
export const PROFIT_PAYMENT_MODE_DEV_TOKEN_HEADER = 'x-payment-dev-token';
