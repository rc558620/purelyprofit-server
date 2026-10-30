import { parseIntValue } from './env.utils';

/**
 * `scanOrdering` 配置块：扫码点餐链路（超时退款、自动清桌、会话有效期）。
 */
export interface ScanOrderingConfig {
  qrTokenEncryptionKey: string;
  /** 上一代桌码加密密钥，用于密钥轮换后仍能解密历史桌码 */
  qrTokenEncryptionKeyPrevious: string;
  /** 待接单超时阈值（毫秒）：支付后超过该时长未接单，系统自动退款 */
  acceptanceTimeoutMs: number;
  /** 制作中超时阈值（毫秒）：接单后超过该时长未出餐，系统自动退款 */
  preparingTimeoutMs: number;
  /** 超时自动退款扫描间隔（毫秒） */
  acceptanceExpirationIntervalMs: number;
  /** 单次超时退款扫描的最大并发数 */
  acceptanceExpirationConcurrency: number;
  /** 退款中订单的自动重试间隔（毫秒） */
  acceptanceExpirationRetryDelayMs: number;
  /** 单笔微信退款的最大自动重试次数 */
  acceptanceExpirationMaxRetries: number;
  /** 自动清桌阈值（毫秒，日间） */
  sessionArchiveIdleMs: number;
  /** 自动清桌阈值（毫秒，夜间） */
  sessionArchiveNightIdleMs: number;
  /** 夜间窗口起始小时（上海时区，含） */
  sessionArchiveNightStartHour: number;
  /** 夜间窗口结束小时（上海时区，不含） */
  sessionArchiveNightEndHour: number;
  /** 桌台会话有效期（毫秒）：决定会话 expiresAt 与 diningRound 复用窗口 */
  sessionTtlMs: number;
}

/** 解析 `scanOrdering` 配置块。 */
export function resolveScanOrderingConfig(): ScanOrderingConfig {
  return {
    qrTokenEncryptionKey:
      process.env.SCAN_ORDERING_QR_TOKEN_ENCRYPTION_KEY ?? '',
    /**
     * 上一代桌码加密密钥（可选）。
     * 用于密钥轮换 / JWT_SECRET 轮换后仍能解密历史桌码的 tokenCiphertext，
     * 否则商家端「重新下载桌码 / 批量导出」会对全部历史桌码抛 500。
     */
    qrTokenEncryptionKeyPrevious:
      process.env.SCAN_ORDERING_QR_TOKEN_ENCRYPTION_KEY_PREVIOUS ?? '',
    /** 待接单超时阈值（毫秒）：支付后超过该时长未接单，系统自动退款 */
    acceptanceTimeoutMs: parseIntValue(
      process.env.SCAN_ORDERING_ACCEPTANCE_TIMEOUT_MS,
      1800000,
    ),
    /** 制作中超时阈值（毫秒）：接单后超过该时长未出餐，系统自动退款 */
    preparingTimeoutMs: parseIntValue(
      process.env.SCAN_ORDERING_PREPARING_TIMEOUT_MS,
      7200000,
    ),
    /** 超时自动退款扫描间隔（毫秒） */
    acceptanceExpirationIntervalMs: parseIntValue(
      process.env.SCAN_ORDERING_ACCEPTANCE_EXPIRATION_INTERVAL_MS,
      60000,
    ),
    /** 单次超时退款扫描的最大并发数 */
    acceptanceExpirationConcurrency: parseIntValue(
      process.env.SCAN_ORDERING_ACCEPTANCE_EXPIRATION_CONCURRENCY,
      8,
    ),
    /** 退款中订单的自动重试间隔（毫秒） */
    acceptanceExpirationRetryDelayMs: parseIntValue(
      process.env.SCAN_ORDERING_ACCEPTANCE_EXPIRATION_RETRY_DELAY_MS,
      300000,
    ),
    /** 单笔微信退款的最大自动重试次数 */
    acceptanceExpirationMaxRetries: parseIntValue(
      process.env.SCAN_ORDERING_ACCEPTANCE_EXPIRATION_MAX_RETRIES,
      3,
    ),
    /**
     * 自动清桌阈值（毫秒，日间）：最后一笔订单履约（或会话最后活跃）落在日间时段时，
     * 超过该时长即归档会话并把桌台置为空桌。
     * 只看最后活动、不等会话 TTL 过期 —— 否则 4 小时 TTL 会成为下限，
     * 午市 12 点的单要拖到 18 点才释放，翻台与统计口径都被拖慢。
     * 默认 2 小时；联调时可临时设 SCAN_ORDERING_SESSION_ARCHIVE_IDLE_MS=180000（3 分钟）加速验证。
     */
    sessionArchiveIdleMs: parseIntValue(
      process.env.SCAN_ORDERING_SESSION_ARCHIVE_IDLE_MS,
      7200000,
    ),
    /**
     * 自动清桌阈值（毫秒，夜间）：最后活动落在夜间窗口时改用该阈值，
     * 并且额外要求会话 expiresAt 已过期，避免把还在座的夜宵 / 火锅客人清掉。
     */
    sessionArchiveNightIdleMs: parseIntValue(
      process.env.SCAN_ORDERING_SESSION_ARCHIVE_NIGHT_IDLE_MS,
      7200000,
    ),
    /** 夜间窗口起始小时（上海时区，含）：最后活动小时 >= 该值按夜间口径处理。 */
    sessionArchiveNightStartHour: parseIntValue(
      process.env.SCAN_ORDERING_SESSION_ARCHIVE_NIGHT_START_HOUR,
      22,
    ),
    /** 夜间窗口结束小时（上海时区，不含）：最后活动小时 < 该值按夜间口径处理。 */
    sessionArchiveNightEndHour: parseIntValue(
      process.env.SCAN_ORDERING_SESSION_ARCHIVE_NIGHT_END_HOUR,
      6,
    ),
    /**
     * 扫码点餐桌台会话有效期（毫秒）：决定会话 expiresAt 与 diningRound 复用窗口。
     * 默认 4 小时（与改造前硬编码一致）；仅联调期临时调小以压缩自动清桌观察周期，生产不要改。
     * 归档时刻 ≈ 会话创建 + 本值 + sessionArchiveIdleMs。
     */
    sessionTtlMs: parseIntValue(
      process.env.SCAN_ORDERING_SESSION_TTL_MS,
      14400000,
    ),
  };
}
