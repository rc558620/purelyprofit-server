/**
 * 微信支付回调队列：队列名、默认任务选项与去重键的唯一事实来源。
 *
 * 为什么必须收敛到一处：
 *  1. 此前 `attempts` / `backoff` / `removeOn*` 在 queue module 与入队侧各写一份，
 *     而 bullmq `Queue.addJob` 是 `mergedOpts = { ...queue.jobsOpts, ...opts }`，
 *     入队侧显式参数会整体覆盖 module 默认值 —— 实际生效的是入队侧那份，
 *     module 里的常量成了死配置，两处漂移后没有任何报错会提示。
 *  2. 队列名此前是 3 处字符串字面量（registerQueue / @InjectQueue / @Processor），
 *     改名漏改一处就是「入队成功但无消费者」的资金事故，且微信已回 200 不会重投。
 *
 * ⚠️ 这里必须写**完整**的默认任务选项，不能只写差异项：
 * nestjs/bullmq 组装队列选项时是浅合并（`{ ...forRoot共享配置, ...registerQueue选项 }`），
 * registerQueue 一旦提供 `defaultJobOptions`，`QueueModule` 里
 * `BullModule.forRootAsync` 的 `timeout` / `removeOnComplete` / `removeOnFail`
 * 对本队列**整体失效**。保留策略必须在这里重新声明，否则任务会被永久保留。
 */
import type { JobsOptions } from 'bullmq';

/** 队列名：注册、注入、消费者三处共用，禁止再写字面量 */
export const CLUB_PAYMENT_CALLBACK_QUEUE_NAME = 'club-payment-callback';

/**
 * 任务名 / jobId 的公共前缀，保证队列面板里一眼看出这是支付回调任务。
 *
 * ⚠️ 分隔符必须用 `-`，**禁止用 `:`**：BullMQ 5.x `Job.validateOptions` 对自定义 jobId
 * 有 `Custom Id cannot contain :` 校验，只因历史兼容留了一个「恰好 3 段冒号」的豁免
 * （源码注释 `TODO: replace this check in next breaking check with include(':')`）。
 * 旧 jobId `wechat-payment:{orderNo}:{transactionId}` 正是靠这个豁免在跑，
 * 一旦升级 bullmq 或 transactionId 里出现冒号，`queue.add` 会在回调链路里直接抛错
 * （此时钱已扣、微信收到 5xx 持续重投，是最难排查的资金事故）。
 */
const JOB_KEY_PREFIX = 'wechat-payment';

/**
 * 最大尝试次数。
 *
 * 支付回调没有「下一周期」可等（微信只重投有限次且很快放弃），
 * 落账失败若不重试就是「钱已扣、余额永久不到账」。
 * 5 次指数退避合计约 30s，覆盖绝大多数瞬时抖动（连接抖动、死锁、锁竞争）；
 * 仍耗尽则落死信 + 告警 + 人工补单（见 ClubPaymentCallbackFailureService）。
 */
const MAX_ATTEMPTS = 5;

/** 指数退避基数：2s → 4s → 8s → 16s，避免依赖方抖动时把重试打在同一秒内 */
const BACKOFF_BASE_DELAY_MS = 2_000;

/** 完成后保留 1 天、最多 1 万条：回调单量远小于定时任务，比全局 count 100 更能支撑事后排查 */
const REMOVE_ON_COMPLETE = { age: 86_400, count: 10_000 };

/** 失败后保留 7 天、最多 1 万条：失败任务要能配合死信表复盘到「哪一步炸的」 */
const REMOVE_ON_FAIL = { age: 604_800, count: 10_000 };

/**
 * 支付回调队列默认任务选项。
 *
 * 刻意**不设 `timeout`**：落账链路是「分布式锁 + 多个短事务 + 事件发布」，
 * 被强制中断会把订单留在中间态（锁已释放、事务已回滚、事件可能已发），
 * 而重试本身是幂等的。worker 真的卡死由进程存活探针/重启兜底。
 * 若将来引入 timeout，必须先确认落账链路内不存在跨事务远程调用。
 */
export const CLUB_PAYMENT_CALLBACK_DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: MAX_ATTEMPTS,
  backoff: {
    type: 'exponential',
    delay: BACKOFF_BASE_DELAY_MS,
  },
  removeOnComplete: REMOVE_ON_COMPLETE,
  removeOnFail: REMOVE_ON_FAIL,
};

/**
 * 任务名与 jobId 同一套构造：都只由订单号决定。
 *
 * jobId 为什么**不含 transactionId**：
 *  - 微信对同一笔支付重投时 transactionId 是稳定的，但运营手工重放、
 *    或不同 transactionId 指向同一个 orderNo 时，会造出第二个 jobId，
 *    同一订单在 `concurrency: 8` 的 worker 上并行跑两遍全链路
 *    （分布式锁只能把它们串行化，白跑一遍完整落账 + 发一遍事件）。
 *  - 收敛到 orderNo 后，同一订单在 waiting / active / delayed 阶段被 BullMQ 去重，
 *    不会重复进入落账链路。
 *  - transactionId 仍完整保存在 job data 的 `settlementParams` 里，
 *    死信表与日志不会丢信息。
 *
 * ⚠️ 去重语义的另一面（有意保留，不要当 bug 改）：
 * jobId 键在 `removeOnComplete`（1 天）/ `removeOnFail`（7 天）生效前一直存在，
 * 期间重复入队会被 BullMQ 直接丢弃（lua `handleDuplicatedJob`）。
 *  - 任务已完成 → 钱已落账，丢弃是正确行为；
 *  - 任务已耗尽重试 → 死信表已有记录并告警，靠
 *    `PulseClubPaymentAdminService.retryRechargeOrder` 人工补单闭环，
 *    不能靠微信重投无限重试。
 */
export function buildClubPaymentCallbackJobKey(orderNo: string): string {
  return `${JOB_KEY_PREFIX}-${orderNo}`;
}
