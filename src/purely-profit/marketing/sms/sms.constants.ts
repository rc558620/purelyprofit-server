// ─── 群发短信：常量与前端对齐的枚举值 ─────────────────────────────────
//
// 凡是「运营口径」的数值（单价 / 告警阈值 / 充值档位 / 分段字数）都可由
// configuration.ts 的 sms 块覆盖，这里的常量只是未配置 env 时的兜底值。

/** 短信单价兜底值（分/条）。前端 mock 的兜底值同为 5。 */
export const SMS_UNIT_PRICE_FEN_DEFAULT = 5;

/** 余额告警阈值兜底值（分）。前端兜底值同为 500。 */
export const SMS_WARNING_THRESHOLD_FEN_DEFAULT = 500;

/**
 * 充值档位兜底值（分）：10 / 50 / 100 / 300 / 500 元。
 *
 * ⚠️ 档位里**没有 bonus 字段**：赠送由 purelyPulse 侧发放并计入 grant 流水，
 * 充值链路不携带任何赠送，前端也不展示赠送文案。
 */
export const SMS_RECHARGE_TIERS_FEN_DEFAULT: readonly number[] = [
  1000, 5000, 10000, 30000, 50000,
];

/** 单条短信最大字数（超出即按长短信拆分） */
export const SMS_SEGMENT_SINGLE_LIMIT_DEFAULT = 70;

/** 长短信每段字数上限 */
export const SMS_SEGMENT_LONG_LIMIT_DEFAULT = 67;

/**
 * 询价单有效期（秒）。
 *
 * 前端明确预期 10 分钟：群发页拿到报价后要停留选人、可能跳去充值再回来，
 * 过期后 `broadcasts` 会拒绝并要求重新询价（防「询价时单价低、发送时单价涨」）。
 */
export const SMS_QUOTE_TTL_SECONDS = 600;

/** 充值订单有效期（秒）：30 分钟未支付惰性置 closed。 */
export const SMS_RECHARGE_ORDER_TTL_SECONDS = 30 * 60;

/**
 * 任务停留在 `sending` 超过该时长即判定为「卡死」。
 *
 * 派发是在扣费事务之外执行的：进程崩溃、发布重启或写库失败都会让任务
 * 没有终态。补偿扫描用这个阈值区分「正在发」与「已经卡住」，
 * 避免把还在途的请求重复派发（同一批人会收到两条短信）。
 */
export const SMS_DISPATCH_STUCK_TIMEOUT_MS = 60_000;

/**
 * 单个群发任务最多派发几次（首次 + 补偿重发）。
 *
 * 超过上限即转 `failed` 并停下：继续重试只会反复消耗通道额度，
 * 剩余问题必须由人工核实后退费，不能靠无限重试掩盖。
 */
export const SMS_DISPATCH_MAX_ATTEMPTS = 3;

/** 补偿扫描单轮最多处理多少个卡死任务（防止一轮拉爆通道） */
export const SMS_BROADCAST_RECOVERY_SCAN_LIMIT = 20;

/** 群发任务列表默认 / 最大分页条数 */
export const SMS_BROADCAST_DEFAULT_PAGE_SIZE = 20;
export const SMS_BROADCAST_MAX_PAGE_SIZE = 100;

/**
 * 扣费事务 Serializable 写冲突（Prisma P2034）的重试次数。
 *
 * Serializable 能防并发超扣，代价是并发写会被数据库直接拒绝一个事务。
 * 这不是资金错误（重试时余额条件会重新判定），不重试就会白白失败一次群发。
 */
export const SMS_CHARGE_RETRY_MAX_ATTEMPTS = 3;

/** 重试退避基数（毫秒），第 n 次退避 n × 基数 */
export const SMS_CHARGE_RETRY_BASE_DELAY_MS = 30;

/**
 * 充值是否走「本地直充」（跳过微信支付直接入账）。
 *
 * 对齐新客额度 `writeRecharge` 的做法：无外部支付单号，用本地单号直接入账，
 * 让「余额不足 → 充值 → 回跳续发」这条链路在微信 Native 开通前就能跑通。
 *
 * ⚠️ 默认 false 且**只在显式开启时生效**——绝不因「微信未配置」自动降级：
 * 那样生产上微信配置一旦失效，用户就能无限免费充值（白送钱）。
 * 接入真支付前必须关掉，服务启动时会打 WARN 提醒。
 */
export const SMS_DIRECT_CREDIT_DEFAULT = false;

/**
 * 腾讯云 SendSms 单次请求的手机号硬上限。
 * 超出会报 `LimitExceeded.PhoneNumberCountLimit`，必须按此切片。
 */
export const TENCENT_SMS_MAX_PHONE_COUNT = 200;

/**
 * 单次群发的收件人上限。
 * 一期与「一页 200 行」的收件人列表口径对齐（见 MARKETING_MAX_PAGE_SIZE）。
 */
export const SMS_MAX_RECIPIENTS_PER_BROADCAST = 200;

/** 短信正文最大长度（超出部分按长短信计费，故给一个明确上限） */
export const SMS_CONTENT_MAX_LENGTH = 500;

/** 短信充值订单号前缀（与 club 的 RC/SV/SO/VC/SF 互斥，回调不会串台） */
export const SMS_ORDER_NO_PREFIX = 'SM';

// ─── 前端对齐的枚举值常量 ─────────────────────────────────────────────

/** 钱包流水类型（与前端 SmsWalletLogType 完全一致）*/
export const SMS_WALLET_LOG_TYPE_VALUES = [
  'recharge',
  'consume',
  'refund',
  'grant',
  'admin_adjust',
] as const;
export type SmsWalletLogTypeValue = (typeof SMS_WALLET_LOG_TYPE_VALUES)[number];

/** 充值订单状态（与前端轮询 status 完全一致）*/
export const SMS_RECHARGE_ORDER_STATUS_VALUES = [
  'pending',
  'paid',
  'closed',
  'failed',
] as const;
export type SmsRechargeOrderStatusValue =
  (typeof SMS_RECHARGE_ORDER_STATUS_VALUES)[number];

/**
 * 腾讯云短信**送达回执**里代表「已送达」的状态码。
 *
 * ⚠️ 这是外部通道的取值，腾讯云不同产品线/版本存在命名差异（SUCCESS / DELIVRD /
 * Ok ...），这里把所有见过的别名都列上；遇到新状态码处理时会打 WARN 日志，
 * 看日志补进来即可，**不要**在这里做「非成功即失败」的假设——未知状态码
 * 一律不落库、不自动退费，宁可漏退也别错退。
 */
export const SMS_DELIVERY_SUCCESS_VALUES: readonly string[] = [
  'SUCCESS',
  'OK',
  '0',
  'DELIVRD',
  'DELIVERED',
  'DELIVER_SUCCESS',
  'SUCCESS_DELIVERED',
];

/** 送达回执里代表「未送达」的状态码（空号 / 停机 / 黑名单 / 退订等） */
export const SMS_DELIVERY_FAILED_VALUES: readonly string[] = [
  'FAIL',
  'FAILED',
  'FAILURE',
  'UNDELIV',
  'UNDELIVERABLE',
  'DELIVER_FAIL',
  'DELIVRD_FAIL',
  'REJECT',
  'REJECTD',
  'BLACK',
  'BLACKLIST',
  'EXPIRED',
  'UNKNOWN',
  'ABSENT_SUBSCRIBER',
  'MEMORY_EXCEEDED',
  'SHUTDOWN',
  'ILLEGAL_SUBSCRIBER',
];

/** 送达状态回调路径（腾讯控制台要配的就是它，默认给一个不易被猜到的路径） */
export const SMS_DELIVERY_CALLBACK_PATH =
  'marketing/sms/tencent/delivery-callback';

/** 主动拉取发送状态时单次拉取条数上限（腾讯云 Limit 参数有上限，别超） */
export const SMS_DELIVERY_PULL_MAX_LIMIT = 100;

/**
 * 通道没有返回某个号码的投递结果。
 *
 * ⚠️ 语义是「**不确定**」，不是「失败」：请求可能已被运营商受理、只是响应里缺了这条。
 * 因此对应明细要保持 pending 走重发，既不能判成功也不能判失败退钱，
 * 只有重发耗尽判死后才能确定它没发出去。
 */
export const SMS_NO_PROVIDER_STATUS_CODE = 'NO_PROVIDER_STATUS';

/**
 * 回执兜底的等待窗口（小时）。
 *
 * 运营商回执不是实时的，通常在发送后几秒到几十分钟内回来，
 * 部分号码甚至更久。太早主动拉取会拿到空结果白跑一趟，
 * 所以这里留出充足缓冲后再去问一次。
 */
export const SMS_DELIVERY_RECONCILE_WAIT_HOURS = 72;

/**
 * 回执兜底的追溯上限（天）。
 *
 * 超过这个天数仍无回执的明细不再主动拉取：腾讯云的状态保留期有限，
 * 再往前拉大概率也拉不到，不如把配额留给近期数据（且避免任务越跑越久）。
 */
export const SMS_DELIVERY_RECONCILE_MAX_AGE_DAYS = 7;

/**
 * 短信计费字数的统计口径。
 *
 * - `codepoint`：Unicode 码点，emoji 记 1 字
 * - `utf16`：UTF-16 码元，emoji 记 2 字
 *
 * 当前默认 `utf16`：腾讯云按 UCS-2 计费，只有用它才能做到「商户实际消耗多少
 * 就付多少」。此前用 codepoint 时含 emoji 的正文会少算段数、少收钱，
 * 而成本按实际段数发生——差额一直是平台在补。
 *
 * ⚠️ 这是一次资金行为变更（含 emoji 的短信会比之前贵），保留 `codepoint` 选项以便回滚。
 * 询价会把口径固化进快照，发送时沿用，因此切换配置不会造成「询价与扣款不一致」。
 */
export const SMS_SEGMENT_COUNT_MODES = ['codepoint', 'utf16'] as const;
export type SmsSegmentCountMode = (typeof SMS_SEGMENT_COUNT_MODES)[number];

export const SMS_SEGMENT_COUNT_MODE_DEFAULT: SmsSegmentCountMode = 'utf16';

/**
 * 允许退费的任务状态。
 *
 * `sending` 刻意不在其中：任务还在派发中，最终可能成功，提前退费等于白送钱。
 * 只有派发结束且确实有失败（failed / partial_failed）才允许人工核实后退费。
 */
export const SMS_BROADCAST_REFUNDABLE_STATUS_VALUES = [
  'failed',
  'partial_failed',
] as const;

/** 群发任务状态（内部口径，不直接对前端）*/
export const SMS_BROADCAST_STATUS_VALUES = [
  'pending',
  'sending',
  'sent',
  'partial_failed',
  'failed',
] as const;
export type SmsBroadcastStatusValue =
  (typeof SMS_BROADCAST_STATUS_VALUES)[number];

/** 收件人投递结果 */
export const SMS_RECIPIENT_STATUS_VALUES = [
  'pending',
  'success',
  'failed',
] as const;
export type SmsRecipientStatusValue =
  (typeof SMS_RECIPIENT_STATUS_VALUES)[number];

/** 前端展示用的流水类型中文文案 */
export const SMS_WALLET_LOG_TYPE_LABELS: Record<SmsWalletLogTypeValue, string> =
  {
    recharge: '充值',
    consume: '群发扣费',
    refund: '退费',
    grant: '平台赠送',
    admin_adjust: '运营调整',
  };
