/**
 * 平台收款对账的运行参数。
 *
 * 思路与 club 充值对账（`ClubRechargeReconciliationService`）一致：
 * 批量上限压住对微信查单接口的调用量，节流窗口挡住重复查单，
 * 分布式锁保证多实例部署时同一时刻只有一个实例在跑。
 *
 * 带 `DEFAULT_` 前缀的是**配置缺失时的兜底值**：对账是后台兜底任务，
 * 环境变量写错不应该让定时任务崩掉（见 `configuration.ts` 的同名映射）。
 */
import type { PlatformWechatTradeState } from './platform-wechat-native.service';

/** 分布式锁 key */
export const PROFIT_PAYMENT_RECONCILE_LOCK_KEY =
  'profit:payment:reconcile:lock';

/** 锁 TTL：单轮的微信调用量有批量上限，5 分钟足够收口 */
export const PROFIT_PAYMENT_RECONCILE_LOCK_TTL_MS = 5 * 60 * 1000;

/** 单轮最多核对订单数 */
export const PROFIT_PAYMENT_RECONCILE_DEFAULT_BATCH_SIZE = 200;

/**
 * 挂起多少分钟才纳入对账。
 *
 * 太短会与正常支付窗口抢单：用户扫码付款到回调到达之间本来就有延迟，
 * 提前查单既没有收益又白耗商户接口额度。
 */
export const PROFIT_PAYMENT_RECONCILE_DEFAULT_MIN_PENDING_MINUTES = 5;

/**
 * 执行间隔：30 分钟。
 *
 * 远大于支付单 15 分钟有效期，保证「确认未支付 → 关单」只在订单真正过期后执行，
 * 同时把丢失回调的自愈延迟控制在半小时内。
 */
export const PROFIT_PAYMENT_RECONCILE_DEFAULT_INTERVAL_MS = 30 * 60 * 1000;

/**
 * 对账时间窗上限：只处理 24 小时内创建的挂起单。
 *
 * 再老的单要么早已被微信侧自动关闭、要么属于需要人工介入的对账差异，
 * 自动补入账不该无边界地追溯历史。
 */
export const PROFIT_PAYMENT_RECONCILE_MAX_PENDING_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * 同一订单向微信发起主动查单的最小间隔（秒）。
 *
 * 定时周期本身已经很长，这里主要防的是「人工手动连点补单」与多实例启动瞬间重叠。
 */
export const PROFIT_PAYMENT_RECONCILE_MIN_QUERY_INTERVAL_SECONDS = 60;

/** 查单节流 key 前缀 */
export const PROFIT_PAYMENT_RECONCILE_THROTTLE_KEY_PREFIX =
  'profit:payment:reconcile:query:';

/**
 * 视为「微信侧确认未支付」的交易状态。
 *
 * 刻意不含 `SUCCESS` / `REFUND` / `UNKNOWN` / `ACCEPT`：
 * 后两者属于结果未确定，拿去关单会误伤已付款的订单。
 */
export const PROFIT_PAYMENT_UNPAID_TRADE_STATES: readonly PlatformWechatTradeState[] =
  ['NOTPAY', 'CLOSED', 'REVOKED', 'PAYERROR'];
