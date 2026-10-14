/** 一天的毫秒数 */
export const DAY_MS = 24 * 60 * 60 * 1000;

/** 距到期多少天开始展示续费横幅 */
export const MEMBERSHIP_EXPIRING_SOON_DAYS = 10;
/** 到期账号每日手动录单上限 */
export const MANUAL_ENTRY_DAILY_LIMIT = 5;
/** 到期账号同时可开台数上限 */
export const MAX_ACTIVE_SPACE_SESSIONS = 1;

/** 每日手动录单计数的 Redis key 前缀 */
export const MANUAL_ENTRY_QUOTA_KEY_PREFIX = 'membership:manual-entry-quota:';

/**
 * 降级态缓存时长（秒）。
 *
 * 仅作为兜底：正常路径下续费会主动失效缓存。
 * 取 60 秒是为了让缓存内的 remainingDays 不会明显失真（以天为单位的展示）。
 */
export const DOWNGRADE_STATE_CACHE_TTL_SECONDS = 60;

/**
 * 时钟漂移探测间隔。
 *
 * 「DB 时钟 − 应用时钟」是慢变量：同一对机器之间几乎不会突变，没必要每次判定
 * 都去查一次库。5 分钟足够及时发现，又不会给读路径增加可感知的开销。
 */
export const CLOCK_DRIFT_PROBE_INTERVAL_MS = 5 * 60 * 1000;

/**
 * 触发告警的时钟差阈值。
 *
 * 取 5s 而不是更小：判定粒度是「天」，且降级态本身有 60s 缓存，秒级以下的漂移
 * 既测不出也修不了任何实际问题，报出来只会变成噪音。
 */
export const CLOCK_DRIFT_WARN_THRESHOLD_MS = 5_000;
